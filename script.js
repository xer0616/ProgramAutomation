
const version = 3
document.getElementById("version").innerText = version;
let originalData = null;
let nalUnitsInfo = []; // Store info about detected NAL units

fetch("original.h265")
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.arrayBuffer();
    })
    .then(buffer => {
        originalData = new Uint8Array(buffer);
        extractNALUnits(originalData);
    })
    .catch(error => {
        console.error("Error loading or processing file:", error);
        document.getElementById("fieldsContainer").innerText = "Error loading H.265 file. Check console for details.";
    });

/**
 * Finds NAL units (Network Abstraction Layer units) within the H.265 byte stream.
 * Supports both 3-byte (0x000001) and 4-byte (0x00000001) start codes.
 * Parses the NAL header and extracts basic fields for specific NAL unit types.
 * @param {Uint8Array} data The H.265 byte stream data.
 */
function extractNALUnits(data) {
    const fieldsContainer = document.getElementById("fieldsContainer");
    fieldsContainer.innerHTML = ""; // Clear previous results
    nalUnitsInfo = []; // Reset NAL unit info

    let i = 0;
    while (i < data.length - 3) { // Need at least 3 bytes for a start code + 2 for NAL header bytes
        let startCodeLength = 0;
        let nalHeaderStartIndex = -1;

        // Check for 4-byte start code: 0x00000001
        if (i + 3 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
            startCodeLength = 4;
            nalHeaderStartIndex = i + 4;
        }
        // Check for 3-byte start code: 0x000001
        else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
            startCodeLength = 3;
            nalHeaderStartIndex = i + 3;
        }

        if (startCodeLength > 0 && nalHeaderStartIndex < data.length - 1) { // Found a start code and have at least 2 bytes for NAL header
            // H.265 NAL Unit Header (2 bytes) - Section 7.3.1.2
            // byte 0: forbidden_zero_bit (1), nal_unit_type (6), nuh_layer_id (upper 1 bit)
            // byte 1: nuh_layer_id (lower 5 bits), nuh_temporal_id_plus1 (3)

            const nalHeaderByte1 = data[nalHeaderStartIndex];
            const nalHeaderByte2 = data[nalHeaderStartIndex + 1];

            const forbiddenZeroBit = (nalHeaderByte1 >> 7) & 0x01; // Should be 0
            const nalType = (nalHeaderByte1 & 0x7E) >> 1;         // Extract bits 6..1 (mask 0111 1110)
            // nuh_layer_id: Combine lower bit of Byte1 and upper 5 bits of Byte 2
            const nuhLayerId = ((nalHeaderByte1 & 0x01) << 5) | (nalHeaderByte2 >> 3);
            // nuh_temporal_id_plus1: Lower 3 bits of Byte 2
            const nuhTemporalIdPlus1 = nalHeaderByte2 & 0x07;     // Extract bits 2..0 (mask 0000 0111)

            // NAL unit payload starts after the 2-byte header
            const nalPayloadStartIndex = nalHeaderStartIndex + 2;

            if (forbiddenZeroBit !== 0) {
                console.warn(`Forbidden zero bit is set at index ${nalHeaderStartIndex}, NAL Type: ${nalType}. Skipping.`);
                i += startCodeLength; // Move past the start code
                continue;
            }

            // Find the end of the current NAL unit (start of the next one or end of data)
            let nextNalUnitStart = data.length;
            // Start searching *after* the current start code
            for (let j = i + startCodeLength; j < data.length - 3; j++) {
                 if ((data[j] === 0 && data[j + 1] === 0 && data[j + 2] === 1) ||
                     (j + 3 < data.length && data[j] === 0 && data[j + 1] === 0 && data[j + 2] === 0 && data[j + 3] === 1)) {
                    nextNalUnitStart = j;
                    break;
                 }
            }

            const nalPayloadEndIndex = nextNalUnitStart;
            const nalPayload = data.subarray(nalPayloadStartIndex, nalPayloadEndIndex);
            const nalName = getNALName(nalType);

            const nalInfo = {
                index: i, // Start index of the start code
                startCodeLength: startCodeLength,
                headerStartIndex: nalHeaderStartIndex,
                payloadStartIndex: nalPayloadStartIndex,
                payloadLength: nalPayload.length,
                type: nalType,
                typeName: nalName,
                layerId: nuhLayerId,
                temporalIdPlus1: nuhTemporalIdPlus1
            };
            nalUnitsInfo.push(nalInfo);

            // Extract fields based on NAL type
            let fields = extractFields(nalType, nalPayload, nalInfo);
            displayFields(nalName, fields, nalUnitsInfo.length - 1); // Pass NAL index for data attributes

            // Move index to the start of the next potential NAL unit
            i = nextNalUnitStart;

        } else {
            // No start code found at this position, move to the next byte
            i++;
        }
    }

    document.getElementById("downloadBtn").disabled = (originalData === null);
}

/**
 * Returns a string name for known H.265 NAL unit types.
 * See Table 7-1 in Rec. ITU-T H.265 (04/2024).
 * @param {number} nalType The NAL unit type value.
 * @returns {string} The name or a generic identifier.
 */
function getNALName(nalType) {
    const nalMap = {
         0: "TRAIL_N",  1: "TRAIL_R",  2: "TSA_N",    3: "TSA_R",
         4: "STSA_N",   5: "STSA_R",   6: "RADL_N",   7: "RADL_R",
         8: "RASL_N",   9: "RASL_R",  10:"RSV_VCL_N10", 11:"RSV_VCL_R11",
        12:"RSV_VCL_N12", 13:"RSV_VCL_R13", 14:"RSV_VCL_N14", 15:"RSV_VCL_R15",
        16: "BLA_W_LP", 17: "BLA_W_RADL", 18: "BLA_N_LP", 19: "IDR_W_RADL",
        20: "IDR_N_LP", 21: "CRA_NUT",   22: "RSV_IRAP_VCL22", 23: "RSV_IRAP_VCL23",
        24:"RSV_VCL24", 25:"RSV_VCL25", 26:"RSV_VCL26", 27:"RSV_VCL27",
        28:"RSV_VCL28", 29:"RSV_VCL29", 30:"RSV_VCL30", 31:"RSV_VCL31",
        32: "VPS_NUT", // Video Parameter Set
        33: "SPS_NUT", // Sequence Parameter Set
        34: "PPS_NUT", // Picture Parameter Set
        35: "AUD_NUT", // Access Unit Delimiter
        36: "EOS_NUT", // End of Sequence
        37: "EOB_NUT", // End of Bitstream
        38: "FD_NUT",  // Filler Data
        39: "PREFIX_SEI_NUT", // Supplemental Enhancement Information (Prefix)
        40: "SUFFIX_SEI_NUT", // Supplemental Enhancement Information (Suffix)
        41:"RSV_NVCL41", 42:"RSV_NVCL42", 43:"RSV_NVCL43", 44:"RSV_NVCL44",
        45:"RSV_NVCL45", 46:"RSV_NVCL46", 47:"RSV_NVCL47",
        // 48..63: Unspecified
    };
    // Add VCL (Video Coding Layer) vs Non-VCL classification
    let suffix = "";
    if (nalType <= 31) {
        suffix = " (VCL)";
    } else if (nalType >= 32 && nalType <= 47) {
        suffix = " (Non-VCL)";
    } else {
        suffix = " (Unspecified)";
    }

    // Add specific handling for reserved types if needed
    let baseName = nalMap[nalType];
    if (!baseName) {
        if (nalType >= 48 && nalType <= 63) {
            baseName = `UNSPEC${nalType}`;
        } else {
            baseName = `Unknown (${nalType})`; // Should not happen based on map
        }
    }

    return baseName + suffix;
}

/**
 * Extracts specific fields from the NAL unit payload based on NAL type.
 * WARNING: This implementation is highly simplified and only parses a few
 * fixed-bit fields at the beginning of VPS, SPS, PPS. It does NOT correctly
 * parse fields encoded with Exp-Golomb (ue(v), se(v)) or handle complex
 * conditional syntax elements present in the H.265 specification.
 * Modifying fields other than the explicitly marked editable ones is likely
 * to corrupt the bitstream.
 * @param {number} nalType The NAL unit type.
 * @param {Uint8Array} payload The NAL unit payload data (starting AFTER the 2-byte NAL header).
 * @param {object} nalInfo Basic info about the NAL unit (includes header fields).
 * @returns {Array<object>} An array of { name, value, byteOffset?, bitOffset?, numBits?, readOnly? } objects.
 */
function extractFields(nalType, payload, nalInfo) {
    let fields = [];
    // Add common NAL header fields for context (always read-only)
    // Note: These are from the NAL header, not the payload itself.
    fields.push({ name: "nuh_layer_id", value: nalInfo.layerId, readOnly: true });
    fields.push({ name: "nuh_temporal_id_plus1", value: nalInfo.temporalIdPlus1, readOnly: true });

    if (payload.length < 1) {
        if (nalType !== 36 /* EOS */ && nalType !== 37 /* EOB */) {
            fields.push({ name: "Warning", value: "Empty Payload", readOnly: true });
        }
        return fields; // No payload to parse
    }

    // --- VPS (Video Parameter Set) ---
    // See Section 7.3.2.1 in H.265 spec (Rec. ITU-T H.265 (04/2024))
    if (nalType === 32) { // VPS_NUT
        // Need at least 2 bytes for the fields parsed below (up to vps_temporal_id_nesting_flag)
        // and 2 more for vps_reserved_0xffff_16bits
        if (payload.length >= 4) {
            // vps_video_parameter_set_id: u(4) - Bits 7..4 of Byte 0
            const vps_video_parameter_set_id = (payload[0] >> 4) & 0x0F;
            fields.push({
                name: "vps_video_parameter_set_id",
                value: vps_video_parameter_set_id,
                byteOffset: 0, // Relative to payload start
                bitOffset: 0,  // Starting bit position (MSB=0) within the byte
                numBits: 4,
                readOnly: false // Allow modification for this example field
            });

            // vps_base_layer_internal_flag: u(1) - Bit 3 of Byte 0
            const vps_base_layer_internal_flag = (payload[0] >> 3) & 0x01;
             fields.push({ name: "vps_base_layer_internal_flag", value: vps_base_layer_internal_flag, byteOffset: 0, bitOffset: 4, numBits: 1, readOnly: true }); // ReadOnly recommended

             // vps_base_layer_available_flag: u(1) - Bit 2 of Byte 0
            const vps_base_layer_available_flag = (payload[0] >> 2) & 0x01;
             fields.push({ name: "vps_base_layer_available_flag", value: vps_base_layer_available_flag, byteOffset: 0, bitOffset: 5, numBits: 1, readOnly: true }); // ReadOnly recommended

            // vps_max_layers_minus1: u(6) - Bits 1..0 of Byte 0 & Bits 7..4 of Byte 1
             const vps_max_layers_minus1 = ((payload[0] & 0x03) << 4) | (payload[1] >> 4);
             fields.push({ name: "vps_max_layers_minus1", value: vps_max_layers_minus1, readOnly: true }); // Spans bytes, modification complex

            // vps_max_sub_layers_minus1: u(3) - Bits 3..1 of Byte 1
            const vps_max_sub_layers_minus1 = (payload[1] >> 1) & 0x07;
             fields.push({ name: "vps_max_sub_layers_minus1", value: vps_max_sub_layers_minus1, byteOffset: 1, bitOffset: 4, numBits: 3, readOnly: true }); // ReadOnly recommended

            // vps_temporal_id_nesting_flag: u(1) - Bit 0 of Byte 1
            const vps_temporal_id_nesting_flag = payload[1] & 0x01;
            fields.push({ name: "vps_temporal_id_nesting_flag", value: vps_temporal_id_nesting_flag, byteOffset: 1, bitOffset: 7, numBits: 1, readOnly: true }); // ReadOnly recommended

            // vps_reserved_0xffff_16bits: f(16) - Bytes 2 and 3 (must be 0xFFFF)
            const reserved_16bits = (payload[2] << 8) | payload[3];
            fields.push({ name: "vps_reserved_0xffff_16bits", value: `0x${reserved_16bits.toString(16).toUpperCase()}`, readOnly: true });
            if (reserved_16bits !== 0xFFFF) {
                 fields.push({ name: "Warning", value: "vps_reserved_0xffff_16bits is not 0xFFFF!", readOnly: true });
            }

            // NOTE: Parsing stops here. The next field is profile_tier_level() which is a complex structure (~12 bytes),
            // followed by potentially many other conditional fields requiring full bitstream parsing logic (Exp-Golomb etc.).
             fields.push({ name: "...", value: "(Further VPS parsing not implemented)", readOnly: true });
        } else {
             fields.push({ name: "Error", value: "Payload too short for basic VPS fields (needs >= 4 bytes)", readOnly: true });
        }
    }
    // --- SPS (Sequence Parameter Set) ---
    // See Section 7.3.2.2 in H.265 spec
    else if (nalType === 33) { // SPS_NUT
         // Need at least 1 byte for the first few flags
         if (payload.length >= 1) {
             // sps_video_parameter_set_id: u(4) - Bits 7..4 of Byte 0
            const sps_video_parameter_set_id = (payload[0] >> 4) & 0x0F;
             fields.push({
                 name: "sps_video_parameter_set_id",
                 value: sps_video_parameter_set_id,
                 byteOffset: 0,
                 bitOffset: 0, // MSB=0
                 numBits: 4,
                 readOnly: true // Typically links to VPS, modification requires care
             });

            // sps_max_sub_layers_minus1: u(3) - Bits 3..1 of Byte 0
            const sps_max_sub_layers_minus1 = (payload[0] >> 1) & 0x07;
             fields.push({ name: "sps_max_sub_layers_minus1", value: sps_max_sub_layers_minus1, byteOffset: 0, bitOffset: 4, numBits: 3, readOnly: true }); // ReadOnly recommended

            // sps_temporal_id_nesting_flag: u(1) - Bit 0 of Byte 0
            const sps_temporal_id_nesting_flag = payload[0] & 0x01;
             fields.push({ name: "sps_temporal_id_nesting_flag", value: sps_temporal_id_nesting_flag, byteOffset: 0, bitOffset: 7, numBits: 1, readOnly: true }); // ReadOnly recommended

            // NOTE: Parsing stops here. Next is profile_tier_level() structure (complex, ~12 bytes)
            // followed by sps_seq_parameter_set_id which is ue(v) - requires Exp-Golomb decoding.
             fields.push({ name: "profile_tier_level()", value: "(Not Parsed)", readOnly: true });
             fields.push({ name: "sps_seq_parameter_set_id", value: "(Requires ue(v) decoding)", readOnly: true });
             fields.push({ name: "...", value: "(Further SPS parsing not implemented)", readOnly: true });
         } else {
             fields.push({ name: "Error", value: "Payload too short for basic SPS fields", readOnly: true });
         }
    }
    // --- PPS (Picture Parameter Set) ---
    // See Section 7.3.2.3 in H.265 spec
    else if (nalType === 34) { // PPS_NUT
        // NOTE: Both pps_pic_parameter_set_id and pps_seq_parameter_set_id are ue(v) encoded
        // and appear right at the beginning. Without ue(v) decoding, we cannot reliably parse them
        // or subsequent fields whose presence/value might depend on them.
        fields.push({ name: "pps_pic_parameter_set_id", value: "(Requires ue(v) decoding)", readOnly: true });
        fields.push({ name: "pps_seq_parameter_set_id", value: "(Requires ue(v) decoding)", readOnly: true });
        fields.push({ name: "...", value: "(Further PPS parsing not implemented)", readOnly: true });
    }
     // --- AUD (Access Unit Delimiter) ---
    // See Section 7.3.2.4 in H.265 spec
    else if (nalType === 35) { // AUD_NUT
        if (payload.length >= 1) {
             // pic_type: u(3) - Bits 7..5 of Byte 0
             const pic_type = (payload[0] >> 5) & 0x07;
             const picTypeMap = { 0: "I", 1: "P, I", 2: "P, B, I", 3: "SI", 4: "SP, SI", 5:"I, SI, SP", 6:"P, B, I, SP, SI", 7:"P, B, I, SP, SI"};
             fields.push({ name: "pic_type", value: `${pic_type} (${picTypeMap[pic_type] || 'Unknown'})`, byteOffset: 0, bitOffset: 0, numBits: 3, readOnly: true });
             // Remaining 5 bits are reserved (rbsp_trailing_bits())
        } else {
             fields.push({ name: "Error", value: "Payload too short for AUD fields", readOnly: true });
        }
    }
    // --- SEI (Supplemental Enhancement Information) ---
    // See Annex D (Prefix SEI) and Annex E (Suffix SEI)
    else if (nalType === 39 || nalType === 40) { // PREFIX_SEI_NUT or SUFFIX_SEI_NUT
        // SEI messages are complex: a sequence of {payloadType, payloadSize, payloadData}
        // Parsing requires looping and handling Exp-Golomb for size/type.
        fields.push({ name: "SEI Message(s)", value: "(Complex structure, not parsed)", readOnly: true });
        fields.push({ name: "...", value: "(SEI parsing not implemented)", readOnly: true });
    }
    // --- Filler Data ---
    else if (nalType === 38) { // FD_NUT
        // Payload consists of 0xFF bytes until the rbsp_trailing_bits()
         let allFF = true;
         for(let k=0; k < payload.length; k++) {
             // Allow for rbsp_trailing_bits which starts with 0x80
             if (k === payload.length - 1 && payload[k] === 0x80) break;
             if (payload[k] !== 0xFF) {
                 allFF = false;
                 break;
             }
         }
         fields.push({ name: "Content", value: allFF ? "All 0xFF (Standard Filler)" : "Contains non-0xFF bytes", readOnly: true });
    }
    // --- EOS / EOB ---
    else if (nalType === 36 || nalType === 37) { // EOS_NUT or EOB_NUT
        // These typically have empty payloads after rbsp_trailing_bits removal.
        // If payload exists here, it might be just the stop bit (0x80).
        if (payload.length > 0) {
             fields.push({ name: "Note", value: `Payload present (${payload.length} bytes), likely contains stop bit.`, readOnly: true });
        } else {
             fields.push({ name: "Note", value: "Empty payload as expected.", readOnly: true });
        }
    }
    // --- VCL NAL Units ---
    else if (nalType <= 31) {
        // Parsing slice headers (slice_segment_header) is extremely complex.
        // It involves many ue(v)/se(v) fields, flags dependent on SPS/PPS, etc.
        fields.push({ name: "Slice Data", value: "(Slice header/data parsing not implemented)", readOnly: true });
    }

    // Add a generic field for unparsed types or if no specific fields were added
    if (fields.length <= 2) { // Only contains the nuh_layer_id/temporal_id fields
         if (nalType > 40 && nalType <= 47) { // Reserved non-VCL
             fields.push({ name: "Reserved Non-VCL", value: "Structure undefined/not parsed", readOnly: true });
         } else if (nalType >= 48 && nalType <= 63) { // Unspecified
             fields.push({ name: "Unspecified", value: "Structure undefined/not parsed", readOnly: true });
         } else if (nalType > 40) { // Catch-all for other unknown types if map is incomplete
              fields.push({ name: "Unknown/Unparsed Type", value: `NAL Type ${nalType}`, readOnly: true });
         }
    }


    return fields;
}

/**
 * Displays the extracted fields in the HTML.
 * @param {string} nalName The name of the NAL unit.
 * @param {Array<object>} fields Array of field objects { name, value, byteOffset?, bitOffset?, numBits?, readOnly? }.
 * @param {number} nalListIndex Index into the global nalUnitsInfo array.
 */
function displayFields(nalName, fields, nalListIndex) {
    const container = document.getElementById("fieldsContainer");

    const nalHeader = document.createElement("h3");
    nalHeader.textContent = `${nalName} (NAL Index: ${nalListIndex}, Offset: ${nalUnitsInfo[nalListIndex].index}, Size: ${nalUnitsInfo[nalListIndex].startCodeLength + 2 + nalUnitsInfo[nalListIndex].payloadLength})`; // Show offset and size
    container.appendChild(nalHeader);

    fields.forEach(field => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";

        const label = document.createElement("label");
        label.textContent = `${field.name}:`;
        if (typeof field.byteOffset === 'number' && typeof field.bitOffset === 'number' && typeof field.numBits === 'number') {
             label.title = `Payload Byte ${field.byteOffset}, Start Bit ${field.bitOffset} (MSB=0), ${field.numBits} bits`;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.value = field.value;
        input.disabled = field.readOnly || false; // Disable input if readOnly

        // Add data attributes ONLY if the field is editable AND has precise location info
        if (!field.readOnly && typeof field.byteOffset === 'number' && typeof field.bitOffset === 'number' && typeof field.numBits === 'number') {
            input.setAttribute('data-nal-index', nalListIndex);
            input.setAttribute('data-field-name', field.name);
            input.setAttribute('data-byte-offset', field.byteOffset); // Offset within payload
            input.setAttribute('data-bit-offset', field.bitOffset);   // Start bit within byte (MSB=0)
            input.setAttribute('data-num-bits', field.numBits);
            input.addEventListener('change', handleFieldChange); // Add listener for changes
        } else if (!field.readOnly) {
            // Mark potentially editable fields that lack precise location info (e.g., ue(v) fields we didn't parse)
             input.setAttribute('data-nal-index', nalListIndex);
             input.setAttribute('data-field-name', field.name);
             input.placeholder = "Cannot modify (complex/variable encoding)";
             input.disabled = true; // Disable modification if location info is missing
        }


        fieldDiv.appendChild(label);
        fieldDiv.appendChild(input);
        container.appendChild(fieldDiv);
    });
}

// Placeholder for handling input changes - currently just logs
function handleFieldChange(event) {
    console.log(`Field changed: NAL ${event.target.dataset.nalIndex}, Field ${event.target.dataset.fieldName}, New Value: ${event.target.value}`);
    // More complex validation could be added here.
    // E.g., check if the new value is within the allowed range for numBits.
    const numBits = parseInt(event.target.dataset.numBits, 10);
    const newValue = parseInt(event.target.value, 10);
    const maxValue = (1 << numBits) - 1;
    if (isNaN(newValue) || newValue < 0 || newValue > maxValue) {
        console.warn(`Input value ${event.target.value} is invalid for ${numBits} bits (0-${maxValue}). Reverting.`);
        // Find the original value to revert (requires storing it or re-parsing)
        // For simplicity, just log the warning for now. A real app might revert the input field.
        // event.target.value = originalValue; // Need a way to get originalValue
    }
}


document.getElementById("downloadBtn").addEventListener("click", function() {
    if (!originalData) {
        console.error("Original data not loaded.");
        return;
    }
    try {
        const modifiedData = modifyStream();
        const blob = new Blob([modifiedData], { type: "video/h265" }); // Correct MIME type
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "updated.h265";
        document.body.appendChild(a); // Required for Firefox
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href); // Clean up
    } catch (error) {
        console.error("Error modifying or downloading stream:", error);
        alert("Error modifying stream. Check console for details. Only limited modifications are currently supported.");
    }
});

/**
 * Creates a modified H.265 stream based on user input fields.
 * WARNING: This currently only supports modifying specific fixed-bit fields
 * (like vps_video_parameter_set_id) where precise byte/bit locations are known
 * AND the field fits entirely within a single byte.
 * Modifying variable-length fields (ue(v), se(v)), fields spanning bytes, or
 * fields affecting subsequent parsing logic is NOT supported and will likely
 * corrupt the stream.
 * @returns {Uint8Array} The modified byte stream.
 */
function modifyStream() {
    if (!originalData) return new Uint8Array([]);

    // Create a mutable copy of the original data
    const modifiedData = new Uint8Array(originalData);

    const inputs = document.querySelectorAll("#fieldsContainer input[data-nal-index][data-byte-offset][data-bit-offset][data-num-bits]");

    inputs.forEach(input => {
        if (input.disabled) {
            return; // Skip read-only/disabled inputs
        }

        const nalListIndex = parseInt(input.dataset.nalIndex, 10);
        const fieldName = input.dataset.fieldName;
        const newValueStr = input.value;

        // Basic validation - ensure it's a non-negative integer
        const newValue = parseInt(newValueStr, 10);
        if (isNaN(newValue) || newValue < 0) {
            console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Invalid non-negative integer "${newValueStr}"`);
            return;
        }

        const byteOffsetInPayload = parseInt(input.dataset.byteOffset, 10);
        const startBitInByte = parseInt(input.dataset.bitOffset, 10); // MSB position (0-7)
        const numBits = parseInt(input.dataset.numBits, 10);

        // Validate data attributes
        if (isNaN(nalListIndex) || isNaN(byteOffsetInPayload) || isNaN(startBitInByte) || isNaN(numBits) || numBits <= 0 || numBits > 8 || startBitInByte < 0 || startBitInByte > 7) {
             console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Invalid data attributes.`);
            return;
        }

        // --- Crucial Check: Ensure field fits within a single byte ---
        if (startBitInByte + numBits > 8) {
             console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Field spans across byte boundary (StartBit ${startBitInByte}, NumBits ${numBits}) - modification not supported by this simple logic.`);
             return;
         }

        const nalInfo = nalUnitsInfo[nalListIndex];
        if (!nalInfo) {
            console.warn(`Skipping field "${fieldName}": Cannot find NAL info for index ${nalListIndex}.`);
            return;
        }

        // Calculate the absolute index in the modifiedData array
        const absoluteByteIndex = nalInfo.payloadStartIndex + byteOffsetInPayload;

        if (absoluteByteIndex >= modifiedData.length) {
            console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Calculated byte index ${absoluteByteIndex} is out of bounds.`);
            return;
        }

        try {
            // --- Bitwise Modification (Single Byte Only) ---

            // 1. Validate new value range for the number of bits.
            const maxValue = (1 << numBits) - 1;
            if (newValue > maxValue) {
                console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: New value ${newValue} out of range for ${numBits} bits (0-${maxValue}). Clamping to ${maxValue}.`);
                // Or you could throw an error, here we clamp it.
                // newValue = maxValue; // Re-assign clamped value if needed downstream
                // For safety, let's just skip if out of range for now.
                 return;
            }

            // 2. Create a mask for the bits we want to change.
            // e.g., numBits=4, startBit=0 (MSB) -> mask = 11110000 (binary) = 0xF0
            let mask = ((1 << numBits) - 1) << (8 - startBitInByte - numBits);

            // 3. Create the new value shifted to the correct position.
            // e.g., numBits=4, startBit=0 (MSB), newValue=5 (0101) -> shifted = 01010000
            let shiftedNewValue = newValue << (8 - startBitInByte - numBits);

            // 4. Get the current byte value.
            let currentByte = modifiedData[absoluteByteIndex];

            // 5. Clear the bits in the original byte using the inverted mask.
            let clearedByte = currentByte & (~mask);

            // 6. Set the new bits using OR.
            let finalByte = clearedByte | shiftedNewValue;

            modifiedData[absoluteByteIndex] = finalByte;

            console.log(`Modified NAL ${nalListIndex}, Field ${fieldName}: Byte ${absoluteByteIndex}, Original: ${currentByte.toString(2).padStart(8,'0')}, Mask: ${mask.toString(2).padStart(8,'0')}, New Value Bits: ${shiftedNewValue.toString(2).padStart(8,'0')}, Result: ${finalByte.toString(2).padStart(8,'0')}`);

        } catch (err) {
            console.error(`Error modifying field "${fieldName}" in NAL ${nalListIndex}:`, err);
            // Optionally re-throw or alert the user
            throw new Error(`Failed to modify field ${fieldName}. Check console.`);
        }
    });

    return modifiedData;
}
