
const version = 2
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
    while (i < data.length - 3) { // Need at least 3 bytes for a start code + 1 for NAL header byte
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
            // H.265 NAL Unit Header (2 bytes)
            // Byte 1: forbidden_zero_bit (1), nal_unit_type (6), nuh_layer_id (6)
            // Byte 2: nuh_temporal_id_plus1 (3)

            const nalHeaderByte1 = data[nalHeaderStartIndex];
            const nalHeaderByte2 = data[nalHeaderStartIndex + 1];

            const forbiddenZeroBit = (nalHeaderByte1 >> 7) & 0x01; // Should be 0
            const nalType = (nalHeaderByte1 & 0x7E) >> 1; // Extract bits 6..1
            const nuhLayerId = ((nalHeaderByte1 & 0x01) << 5) | (nalHeaderByte2 >> 3); // Extract lower bit of Byte1 and upper 5 bits of Byte 2
            const nuhTemporalIdPlus1 = nalHeaderByte2 & 0x07; // Extract lower 3 bits of Byte 2

            // NAL unit payload starts after the 2-byte header
            const nalPayloadStartIndex = nalHeaderStartIndex + 2;

            if (forbiddenZeroBit !== 0) {
                console.warn(`Forbidden zero bit is set at index ${nalHeaderStartIndex}, NAL Type: ${nalType}. Skipping.`);
                i += startCodeLength; // Move past the start code
                continue;
            }

            // Find the end of the current NAL unit (start of the next one or end of data)
            let nextNalUnitStart = data.length;
            for (let j = nalHeaderStartIndex; j < data.length - 3; j++) {
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

            // Extract fields only for specific NAL types we handle
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
         8: "RASL_N",   9: "RASL_R",  16: "BLA_W_LP", 17: "BLA_W_RADL",
        18: "BLA_N_LP", 19: "IDR_W_RADL", 20: "IDR_N_LP", 21: "CRA_NUT",
        22: "RSV_IRAP_VCL22", 23: "RSV_IRAP_VCL23",
        32: "VPS_NUT", // Video Parameter Set
        33: "SPS_NUT", // Sequence Parameter Set
        34: "PPS_NUT", // Picture Parameter Set
        35: "AUD_NUT", // Access Unit Delimiter
        36: "EOS_NUT", // End of Sequence
        37: "EOB_NUT", // End of Bitstream
        38: "FD_NUT",  // Filler Data
        39: "PREFIX_SEI_NUT", // Supplemental Enhancement Information (Prefix)
        40: "SUFFIX_SEI_NUT", // Supplemental Enhancement Information (Suffix)
        // Other types exist (Reserved, Unspecified)
    };
    // Add VCL (Video Coding Layer) vs Non-VCL classification
    let suffix = "";
    if (nalType >= 0 && nalType <= 31) {
        suffix = " (VCL)";
    } else if (nalType >= 32) {
        suffix = " (Non-VCL)";
    }
    return (nalMap[nalType] || `Reserved/Unspecified (${nalType})`) + suffix;
}

/**
 * Extracts specific fields from the NAL unit payload based on NAL type.
 * WARNING: This implementation is highly simplified and only parses a few
 * fixed-bit fields at the beginning of VPS, SPS, PPS. It does NOT correctly
 * parse fields encoded with Exp-Golomb (ue(v), se(v)) or handle complex
 * conditional syntax elements present in the H.265 specification.
 * @param {number} nalType The NAL unit type.
 * @param {Uint8Array} payload The NAL unit payload data (starting AFTER the 2-byte NAL header).
 * @param {object} nalInfo Basic info about the NAL unit.
 * @returns {Array<object>} An array of { name, value, byteOffset, bitOffset, numBits } objects.
 */
function extractFields(nalType, payload, nalInfo) {
    let fields = [];
    // Add common header fields for context
    fields.push({ name: "nuh_layer_id", value: nalInfo.layerId, readOnly: true });
    fields.push({ name: "nuh_temporal_id_plus1", value: nalInfo.temporalIdPlus1, readOnly: true });

    if (payload.length < 1) return fields; // Need at least one byte for most parameter sets

    // --- VPS (Video Parameter Set) ---
    // See Section 7.3.2.1 in H.265 spec
    if (nalType === 32) { // VPS_NUT
        if (payload.length >= 2) { // Need at least ~2 bytes for these initial fields
            // vps_video_parameter_set_id: u(4) - 4 bits
            const vps_video_parameter_set_id = (payload[0] >> 4) & 0x0F;
            fields.push({
                name: "vps_video_parameter_set_id",
                value: vps_video_parameter_set_id,
                byteOffset: 0, // Relative to payload start
                bitOffset: 4,  // Starting bit position (from MSB, 0-7)
                numBits: 4
            });

            // vps_base_layer_internal_flag: u(1) - 1 bit
            const vps_base_layer_internal_flag = (payload[0] >> 3) & 0x01;
             fields.push({ name: "vps_base_layer_internal_flag", value: vps_base_layer_internal_flag, readOnly: true }); // Example

             // vps_base_layer_available_flag: u(1) - 1 bit
            const vps_base_layer_available_flag = (payload[0] >> 2) & 0x01;
             fields.push({ name: "vps_base_layer_available_flag", value: vps_base_layer_available_flag, readOnly: true }); // Example

             // vps_max_layers_minus1: u(6) - spans byte 0 and 1
             // Bits 1..0 of byte 0, Bits 7..4 of byte 1
             const vps_max_layers_minus1 = ((payload[0] & 0x03) << 4) | ((payload[1] >> 4) & 0x0F);
             fields.push({ name: "vps_max_layers_minus1", value: vps_max_layers_minus1, readOnly: true }); // Example

            // vps_max_sub_layers_minus1: u(3) - 3 bits in byte 1
            const vps_max_sub_layers_minus1 = (payload[1] >> 1) & 0x07;
             fields.push({ name: "vps_max_sub_layers_minus1", value: vps_max_sub_layers_minus1, readOnly: true }); // Example

            // vps_temporal_id_nesting_flag: u(1) - 1 bit in byte 1
            const vps_temporal_id_nesting_flag = payload[1] & 0x01;
            fields.push({ name: "vps_temporal_id_nesting_flag", value: vps_temporal_id_nesting_flag, readOnly: true });

            // NOTE: Parsing stops here. The rest of VPS requires complex parsing (profile_tier_level, sub-layer flags, timing info, etc.)
             fields.push({ name: "...", value: "(Further VPS parsing not implemented)", readOnly: true });
        } else {
             fields.push({ name: "Error", value: "Payload too short for basic VPS fields", readOnly: true });
        }
    }
    // --- SPS (Sequence Parameter Set) ---
    // See Section 7.3.2.2 in H.265 spec
    else if (nalType === 33) { // SPS_NUT
         if (payload.length >= 2) { // Need at least ~2 bytes for initial fields
             // sps_video_parameter_set_id: u(4) - 4 bits
            const sps_video_parameter_set_id = (payload[0] >> 4) & 0x0F;
             fields.push({
                 name: "sps_video_parameter_set_id",
                 value: sps_video_parameter_set_id,
                 byteOffset: 0,
                 bitOffset: 4,
                 numBits: 4
             });

            // sps_max_sub_layers_minus1: u(3) - 3 bits
            const sps_max_sub_layers_minus1 = (payload[0] >> 1) & 0x07;
             fields.push({ name: "sps_max_sub_layers_minus1", value: sps_max_sub_layers_minus1, readOnly: true }); // Example

            // sps_temporal_id_nesting_flag: u(1) - 1 bit
            const sps_temporal_id_nesting_flag = payload[0] & 0x01;
             fields.push({ name: "sps_temporal_id_nesting_flag", value: sps_temporal_id_nesting_flag, readOnly: true }); // Example

            // NOTE: Parsing stops here. Next is profile_tier_level() structure (complex, ~12 bytes)
            // followed by sps_seq_parameter_set_id which is ue(v) - requires Exp-Golomb decoding.
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
        // or subsequent fields whose presence might depend on them.
        fields.push({ name: "pps_pic_parameter_set_id", value: "(Requires ue(v) decoding)", readOnly: true });
        fields.push({ name: "pps_seq_parameter_set_id", value: "(Requires ue(v) decoding)", readOnly: true });
        fields.push({ name: "...", value: "(Further PPS parsing not implemented)", readOnly: true });
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
    nalHeader.textContent = `${nalName} (NAL Index: ${nalListIndex})`;
    container.appendChild(nalHeader);

    fields.forEach(field => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";

        const label = document.createElement("label");
        label.textContent = `${field.name}:`;

        const input = document.createElement("input");
        input.type = "text";
        input.value = field.value;
        input.disabled = field.readOnly || false; // Disable input if readOnly

        // Add data attributes to link the input back to the NAL unit and field definition
        if (!field.readOnly && typeof field.byteOffset === 'number' && typeof field.bitOffset === 'number' && typeof field.numBits === 'number') {
            input.setAttribute('data-nal-index', nalListIndex);
            input.setAttribute('data-field-name', field.name);
            input.setAttribute('data-byte-offset', field.byteOffset); // Offset within payload
            input.setAttribute('data-bit-offset', field.bitOffset);   // Start bit within byte (MSB=7)
            input.setAttribute('data-num-bits', field.numBits);
            input.addEventListener('change', handleFieldChange); // Add listener for changes
        } else if (!field.readOnly) {
            // Mark editable fields that lack precise location info (e.g., ue(v) fields we didn't parse)
             input.setAttribute('data-nal-index', nalListIndex);
             input.setAttribute('data-field-name', field.name);
             input.placeholder = "Cannot modify (complex encoding)";
             input.disabled = true;
        }


        fieldDiv.appendChild(label);
        fieldDiv.appendChild(input);
        container.appendChild(fieldDiv);
    });
}

// Placeholder for handling input changes - currently does nothing until modifyStream is properly implemented
function handleFieldChange(event) {
    console.log(`Field changed: NAL ${event.target.dataset.nalIndex}, Field ${event.target.dataset.fieldName}, New Value: ${event.target.value}`);
    // In a full implementation, you might want to validate the input here
    // and possibly update an intermediate data structure before modifyStream is called.
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
 * (like vps_video_parameter_set_id) where precise byte/bit locations are known.
 * Modifying variable-length fields or fields affecting subsequent parsing is NOT supported
 * and will likely corrupt the stream.
 * @returns {Uint8Array} The modified byte stream.
 */
function modifyStream() {
    if (!originalData) return new Uint8Array([]);

    // Create a mutable copy of the original data
    const modifiedData = new Uint8Array(originalData);

    const inputs = document.querySelectorAll("#fieldsContainer input[data-nal-index]");

    inputs.forEach(input => {
        if (input.disabled || !input.dataset.fieldName || typeof input.dataset.byteOffset === 'undefined') {
            return; // Skip read-only, disabled, or incorrectly tagged inputs
        }

        const nalListIndex = parseInt(input.dataset.nalIndex, 10);
        const fieldName = input.dataset.fieldName;
        const newValueStr = input.value;

        // Basic validation - ensure it's a number for bitwise operations
        const newValue = parseInt(newValueStr, 10);
        if (isNaN(newValue)) {
            console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Invalid number "${newValueStr}"`);
            return;
        }

        const byteOffsetInPayload = parseInt(input.dataset.byteOffset, 10);
        const startBitInByte = parseInt(input.dataset.bitOffset, 10); // Position of the LSB of our field within the byte (0-7)
        const numBits = parseInt(input.dataset.numBits, 10);

        if (isNaN(nalListIndex) || isNaN(byteOffsetInPayload) || isNaN(startBitInByte) || isNaN(numBits) || numBits <= 0 || numBits > 8 || startBitInByte < 0 || startBitInByte > 7) {
             console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Invalid data attributes.`);
            return;
        }

        const nalInfo = nalUnitsInfo[nalListIndex];
        if (!nalInfo) {
            console.warn(`Skipping field "${fieldName}": Cannot find NAL info for index ${nalListIndex}.`);
            return;
        }

        const absoluteByteIndex = nalInfo.payloadStartIndex + byteOffsetInPayload;

        if (absoluteByteIndex >= modifiedData.length) {
            console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Calculated byte index ${absoluteByteIndex} is out of bounds.`);
            return;
        }

        try {
            // --- Bitwise Modification ---
            // IMPORTANT: This assumes the field fits entirely within a SINGLE byte.
            // Modifications spanning bytes are much more complex.
             if (startBitInByte + numBits > 8) {
                 console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: Field spans across byte boundary - modification not supported by this simple logic.`);
                 return;
             }

            // 1. Create a mask for the bits we want to change.
            // e.g., numBits=4, startBit=4 -> mask = 11110000 (binary) = 0xF0
            let mask = ((1 << numBits) - 1) << (8 - startBitInByte - numBits); // Adjusted for MSB position

             // 2. Create the new value shifted to the correct position.
             // Ensure the new value doesn't exceed the allocated bits.
             const maxValue = (1 << numBits) - 1;
             if (newValue < 0 || newValue > maxValue) {
                 console.warn(`Skipping field "${fieldName}" in NAL ${nalListIndex}: New value ${newValue} out of range for ${numBits} bits (0-${maxValue}).`);
                return;
             }
             let shiftedNewValue = newValue << (8 - startBitInByte - numBits); // Adjusted for MSB position

            // 3. Clear the bits in the original byte using the inverted mask.
            let currentByte = modifiedData[absoluteByteIndex];
            let clearedByte = currentByte & (~mask);

            // 4. Set the new bits using OR.
            modifiedData[absoluteByteIndex] = clearedByte | shiftedNewValue;

            console.log(`Modified NAL ${nalListIndex}, Field ${fieldName}: Byte ${absoluteByteIndex}, Original: ${currentByte.toString(2).padStart(8,'0')}, New: ${modifiedData[absoluteByteIndex].toString(2).padStart(8,'0')}`);

        } catch (err) {
            console.error(`Error modifying field "${fieldName}" in NAL ${nalListIndex}:`, err);
            // Optionally re-throw or alert the user
            throw new Error(`Failed to modify field ${fieldName}. Check console.`);
        }
    });

    return modifiedData;
}
