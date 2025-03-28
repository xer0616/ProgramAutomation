
const version = 6
// Ensure the element exists before setting innerText
const versionElement = document.getElementById("version");
if (versionElement) {
    versionElement.innerText = version;
} else {
    console.warn("Element with ID 'version' not found.");
}
let originalData = null;

fetch("original.h265")
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.arrayBuffer();
    })
    .then(buffer => {
        originalData = new Uint8Array(buffer);
        console.log(`Loaded ${originalData.length} bytes.`);
        extractNALUnits(originalData);
    })
    .catch(error => console.error("Error loading file:", error));

function extractNALUnits(data) {
    const fieldsContainer = document.getElementById("fieldsContainer");
    if (!fieldsContainer) {
        console.error("Element with ID 'fieldsContainer' not found.");
        return;
    }
    fieldsContainer.innerHTML = ""; // Clear previous fields

    let nalUnitCount = 0;
    let nalStart = -1;
    let zeroCount = 0;

    for (let i = 0; i < data.length; i++) {
        if (zeroCount >= 2 && data[i] === 1) { // Found potential start code (00 00 01 or 00 00 00 01)
            const startCodeLen = zeroCount === 2 ? 3 : 4;

            if (nalStart !== -1) {
                // Process the *previous* NAL unit (from nalStart to i - startCodeLen)
                // The NAL unit data itself starts *after* the start code prefix
                processNalUnit(data.subarray(nalStart, i - startCodeLen));
                nalUnitCount++;
            }

            // Start of the new NAL unit (immediately after the start code)
            nalStart = i + 1;

            // Reset zero count
            zeroCount = 0;

        } else if (data[i] === 0) {
            zeroCount++;
        } else {
            zeroCount = 0;
        }
    }

    // Process the last NAL unit if the file doesn't end with a start code
    if (nalStart !== -1) {
        processNalUnit(data.subarray(nalStart));
        nalUnitCount++;
    }

    console.log(`Found and processed ${nalUnitCount} NAL units.`);
    const downloadBtn = document.getElementById("downloadBtn");
    if (downloadBtn) {
        downloadBtn.disabled = nalUnitCount === 0; // Disable if no NAL units found/processed
    } else {
        console.warn("Element with ID 'downloadBtn' not found.");
    }
}

function processNalUnit(nalUnitData) {
    if (nalUnitData.length < 2) {
        // console.warn("Skipping NAL unit: Too short for header.");
        return; // Need at least 2 bytes for H.265 NAL header
    }

    // H.265 NAL Unit Header (2 bytes) - ITU-T H.265 Section 7.3.1.1
    const headerByte1 = nalUnitData[0];
    const headerByte2 = nalUnitData[1];

    // forbidden_zero_bit: f(1) (bit 7 of byte 0) - Should be 0
    const forbiddenZeroBit = (headerByte1 >> 7) & 0x01;
    // nal_unit_type: u(6) (bits 6-1 of byte 0)
    const nalType = (headerByte1 & 0x7E) >> 1;
    // nuh_layer_id: u(6) (bit 0 of byte 0 combined with bits 7-3 of byte 1)
    // Corrected combination: Bit 0 of Byte 1 is actually part of temporal_id_plus1
    const nuhLayerId = ((headerByte1 & 0x01) << 5) | (headerByte2 >> 3); // Correct extraction for nuh_layer_id
    // nuh_temporal_id_plus1: u(3) (bits 2-0 of byte 1)
    const nuhTemporalIdPlus1 = headerByte2 & 0x07;


    const nalName = getNALName(nalType);

    if (forbiddenZeroBit !== 0) {
        console.warn(`Forbidden zero bit is not zero (${forbiddenZeroBit}) for NAL Unit ${nalName} (${nalType}).`);
    }
    if (nuhTemporalIdPlus1 === 0) {
        // Note: TemporalIdPlus1 being 0 is *valid* according to the spec (temporal_id = 0).
        // The previous warning might have been based on a misunderstanding or specific profile constraint.
        // Keeping the log for now, but it might not indicate an error.
        // console.log(`Temporal ID Plus 1 is zero for NAL Unit ${nalName} (${nalType}), meaning temporal_id = 0.`);
    }

    // The NAL unit payload (RBSP) starts after the 2-byte header.
    const payloadData = nalUnitData.subarray(2);

    // Extract fields based on NAL type
    const fields = extractFields(nalType, payloadData);

    // Display the extracted fields
    if (fields.length > 0) {
        displayFields(nalName, nalType, fields, nuhLayerId, nuhTemporalIdPlus1); // Pass header fields
    }
}


function getNALName(nalType) {
    // H.265 NAL Unit Types (ITU-T H.265 Table 7-1)
    const nalMap = {
         0: "TRAIL_N", 1: "TRAIL_R", 2: "TSA_N", 3: "TSA_R", 4: "STSA_N", 5: "STSA_R",
         6: "RADL_N", 7: "RADL_R", 8: "RASL_N", 9: "RASL_R",
        10: "RSV_VCL_N10", 11: "RSV_VCL_R11", 12: "RSV_VCL_N12", 13: "RSV_VCL_R13",
        14: "RSV_VCL_N14", 15: "RSV_VCL_R15",
        16: "BLA_W_LP", 17: "BLA_W_RADL", 18: "BLA_N_LP",
        19: "IDR_W_RADL", 20: "IDR_N_LP",
        21: "CRA_NUT",
        22: "RSV_IRAP_VCL22", 23: "RSV_IRAP_VCL23",
        // 24-31 Reserved non-IRAP VCL
        32: "VPS_NUT",        // Video Parameter Set
        33: "SPS_NUT",        // Sequence Parameter Set
        34: "PPS_NUT",        // Picture Parameter Set
        35: "AUD_NUT",        // Access Unit Delimiter
        36: "EOS_NUT",        // End of Sequence
        37: "EOB_NUT",        // End of Bitstream
        38: "FD_NUT",         // Filler Data
        39: "PREFIX_SEI_NUT", // Supplemental enhancement information (SEI) prefix
        40: "SUFFIX_SEI_NUT", // Supplemental enhancement information (SEI) suffix
        // 41-47 Reserved
        // 48-63 Unspecified
    };
    if (nalType >= 24 && nalType <= 31) return `RSV_NVCL (${nalType})`; // Renamed from VCL to NVCL per spec Table 7-1 for this range
    if (nalType >= 41 && nalType <= 47) return `RSV_NVCL (${nalType})`;
    if (nalType >= 48 && nalType <= 63) return `UNSPEC (${nalType})`;

    return nalMap[nalType] || `Reserved/Unknown (${nalType})`;
}

function extractFields(nalType, payloadData) {
    // --- IMPORTANT ---
    // This function provides a VERY simplified extraction for specific fields
    // in VPS/SPS/PPS based on direct byte access *without* proper RBSP handling
    // (emulation prevention byte removal 0x000003 -> 0x0000) or bitstream parsing (like Exp-Golomb).
    // This will be inaccurate for many fields and potentially incorrect if
    // emulation prevention bytes (0x03) are present within the payload.
    // --- ---
    let fields = [];
    let currentBitOffset = 0; // Track bits for more complex future parsing (not fully used yet)

    if (payloadData.length < 1 && ![36, 37].includes(nalType) /* EOS/EOB can be empty */) {
       // console.warn(`NAL unit payload potentially too short for NAL Type ${nalType}.`);
       // Allow processing to continue for empty NALs like EOS/EOB
       // return fields; // Removed this early return to handle empty NALs gracefully
    }

    try {
        if (nalType === 32) { // VPS_NUT (Video Parameter Set - ITU-T H.265 Section 7.3.2.1)
             // Check sufficient length for the fixed initial fields
            if (payloadData.length < 4) { // Need 4 bytes for vps_reserved_0xffff_16bits
                fields.push({ name: "ERROR", value: "Payload too short for initial VPS fields", type: 'error' });
                return fields;
            }

            // vps_video_parameter_set_id: u(4) -> Upper 4 bits of payload byte 0
            const vps_video_parameter_set_id = (payloadData[0] >> 4) & 0x0F;
            fields.push({ name: "vps_video_parameter_set_id", value: vps_video_parameter_set_id, bits: 4, type: 'u' });
            currentBitOffset += 4;

            // vps_base_layer_internal_flag: u(1) -> Bit 3 of payload byte 0
            const vps_base_layer_internal_flag = (payloadData[0] >> 3) & 0x01;
            fields.push({ name: "vps_base_layer_internal_flag", value: vps_base_layer_internal_flag, bits: 1, type: 'u' });
            currentBitOffset += 1;

            // vps_base_layer_available_flag: u(1) -> Bit 2 of payload byte 0
            const vps_base_layer_available_flag = (payloadData[0] >> 2) & 0x01;
            fields.push({ name: "vps_base_layer_available_flag", value: vps_base_layer_available_flag, bits: 1, type: 'u' });
            currentBitOffset += 1;

             // vps_max_layers_minus1: u(6) -> Bits 1-0 of byte 0, and bits 7-4 of byte 1
             const val_byte0 = (payloadData[0] & 0x03); // Lower 2 bits
             const val_byte1_hi = (payloadData[1] >> 4) & 0x0F; // Upper 4 bits
             const vps_max_layers_minus1 = (val_byte0 << 4) | val_byte1_hi;
             fields.push({ name: "vps_max_layers_minus1", value: vps_max_layers_minus1, bits: 6, type: 'u'});
             currentBitOffset += 6; // Now at 12 bits total (1.5 bytes)

            // vps_max_sub_layers_minus1: u(3) -> bits 3-1 of byte 1
            const vps_max_sub_layers_minus1 = (payloadData[1] >> 1) & 0x07;
            fields.push({ name: "vps_max_sub_layers_minus1", value: vps_max_sub_layers_minus1, bits: 3, type: 'u' });
            currentBitOffset += 3; // Now at 15 bits total

            // vps_temporal_id_nesting_flag: u(1) -> bit 0 of byte 1 (Corrected based on spec H.265 7.3.2.1)
            const vps_temporal_id_nesting_flag = payloadData[1] & 0x01;
            fields.push({ name: "vps_temporal_id_nesting_flag", value: vps_temporal_id_nesting_flag, bits: 1, type: 'u' });
            currentBitOffset += 1; // Now at 16 bits total (2 bytes)

             // vps_reserved_0xffff_16bits: f(16) -> Bytes 2 and 3
             const vps_reserved_0xffff_16bits = (payloadData[2] << 8) | payloadData[3];
             if (vps_reserved_0xffff_16bits !== 0xFFFF) {
                 console.warn(`VPS reserved bits are not 0xFFFF (found 0x${vps_reserved_0xffff_16bits.toString(16)})`);
             }
             fields.push({ name: "vps_reserved_0xffff_16bits", value: `0x${payloadData[2].toString(16).padStart(2, '0')}${payloadData[3].toString(16).padStart(2, '0')}`, bits: 16, type: 'f' }); // Simplified display
             currentBitOffset += 16; // Now at 32 bits total (4 bytes)

             // profile_tier_level structure follows - complex parsing needed
             // Requires parsing based on vps_max_sub_layers_minus1 value.
             fields.push({ name: "profile_tier_level(...)", value: "...", type: 'struct', comment: `Requires parsing ${1 + vps_max_sub_layers_minus1} levels` }); // Placeholder

             // Simplified: just point out that more data follows
             if (payloadData.length > 4) {
                 fields.push({ name: "vps_extension_etc", value: "...", type: 'data' });
             }


        } else if (nalType === 33) { // SPS_NUT (Sequence Parameter Set - ITU-T H.265 Section 7.3.2.2)
            if (payloadData.length < 1) { // Need at least one byte for first few fields
               fields.push({ name: "ERROR", value: "Payload too short for initial SPS fields", type: 'error' });
               return fields;
            }
            currentBitOffset = 0;
            // sps_video_parameter_set_id: u(4) -> Upper 4 bits of the first payload byte
            fields.push({ name: "sps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F, bits: 4, type: 'u' });
            currentBitOffset += 4;
            // sps_max_sub_layers_minus1: u(3) -> Next 3 bits (bits 3-1 of byte 0)
            const sps_max_sub_layers_minus1 = (payloadData[0] >> 1) & 0x07;
            fields.push({ name: "sps_max_sub_layers_minus1", value: sps_max_sub_layers_minus1, bits: 3, type: 'u' });
            currentBitOffset += 3;
            // sps_temporal_id_nesting_flag: u(1) -> Next 1 bit (bit 0 of byte 0)
            fields.push({ name: "sps_temporal_id_nesting_flag", value: payloadData[0] & 0x01, bits: 1, type: 'u' });
            currentBitOffset += 1; // Now at 8 bits (1 byte)

            // profile_tier_level(...) structure follows - complex parsing needed
            // Requires parsing based on sps_max_sub_layers_minus1 value.
             fields.push({ name: "profile_tier_level(...)", value: "...", type: 'struct', comment: `Requires parsing ${1 + sps_max_sub_layers_minus1} levels` }); // Placeholder

            // The *next* fields require Exp-Golomb decoding and knowledge of profile_tier_level size
            fields.push({ name: "sps_seq_parameter_set_id", value: "...", type: 'ue', comment: "Exp-Golomb encoded" }); // Placeholder - requires proper parsing
            fields.push({ name: "chroma_format_idc", value: "...", type: 'ue', comment: "Exp-Golomb encoded" }); // Placeholder
            // ... other fields ...
            if (payloadData.length > 1) { // Indicate more data exists
                 fields.push({ name: "sps_remaining_data", value: "...", type: 'data' });
            }

        } else if (nalType === 34) { // PPS_NUT (Picture Parameter Set - ITU-T H.265 Section 7.3.2.3)
            // These first two fields require Exp-Golomb decoding from the start of the payload
             fields.push({ name: "pps_pic_parameter_set_id", value: "...", type: 'ue', comment: "Exp-Golomb encoded" }); // Placeholder
             fields.push({ name: "pps_seq_parameter_set_id", value: "...", type: 'ue', comment: "Exp-Golomb encoded" }); // Placeholder
            // Add more PPS fields as placeholders if needed...
            fields.push({ name: "dependent_slice_segments_enabled_flag", value: "...", type: 'u', bits: 1, comment: "Requires parsing previous fields"}); // Placeholder
            fields.push({ name: "output_flag_present_flag", value: "...", type: 'u', bits: 1, comment: "Requires parsing previous fields"}); // Placeholder
             // ... other fields ...
             if (payloadData.length > 0) { // Indicate more data exists
                 fields.push({ name: "pps_remaining_data", value: "...", type: 'data' });
             }
        } else if (nalType === 35) { // AUD_NUT (Access Unit Delimiter - ITU-T H.265 Section 7.3.2.5)
             if (payloadData.length >= 1) {
                // pic_type: u(3) -> bits 7-5 of the first payload byte
                const pic_type = (payloadData[0] >> 5) & 0x07;
                fields.push({ name: "pic_type", value: pic_type, bits: 3, type: 'u' });
                // TODO: Could add mapping for pic_type values (0: I, 1: P/I, 2: B/P/I, etc.)
             } else {
                 fields.push({ name: "ERROR", value: "Payload too short for AUD fields", type: 'error' });
             }
        } else if (nalType === 39 || nalType === 40) { // PREFIX_SEI_NUT or SUFFIX_SEI_NUT
            // SEI messages are complex (list of messages, each with type/size/payload)
            // This is a highly simplified placeholder
             fields.push({ name: "SEI Message(s)", value: "...", type: 'complex', comment: "Requires full SEI parsing" });
             if (payloadData.length > 0) {
                  fields.push({ name: "sei_data_preview", value: `[${payloadData.slice(0, Math.min(8, payloadData.length)).join(', ')}...]`, type: 'data' });
             }
        }
        // Add extraction logic for other NAL types if needed (e.g., FD_NUT)
        // Note: EOS_NUT (36), EOB_NUT (37) have no syntax elements in their RBSP.
        else if (nalType === 36 || nalType === 37) {
             // No fields to extract, but presence is meaningful
             // fields.push({ name: "Note", value: "No payload fields defined", type: 'info' });
        }

    } catch (e) {
        console.error(`Error parsing NAL unit type ${nalType}:`, e);
        // Add a field indicating the error
        fields.push({ name: "PARSING_ERROR", value: e.message || "Unknown Error", type: "error" });
    }
    return fields;
}

// Added nuhLayerId, nuhTemporalIdPlus1 to display NAL header info as well
function displayFields(nalName, nalType, fields, nuhLayerId, nuhTemporalIdPlus1) {
    const container = document.getElementById("fieldsContainer");
    if (!container) return;

    // --- Display NAL Header Fields First ---
    const headerFields = [
        { name: "nuh_layer_id", value: nuhLayerId, bits: 6, type: 'u', comment: "From NAL Header" },
        { name: "nuh_temporal_id_plus1", value: nuhTemporalIdPlus1, bits: 3, type: 'u', comment: "From NAL Header" }
    ];

    headerFields.forEach((field, index) => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field header-field"; // Add class to distinguish header fields

        // Use a unique identifier
        const sanitizedFieldName = field.name.replace(/\W/g, '_');
        const inputId = `nal-${nalType}-header-${sanitizedFieldName}-${index}`;

        // Header fields are generally considered read-only in this context
        const isReadOnly = true;
        const titleValue = field.comment ? ` title="${field.comment}"` : '';

        fieldDiv.innerHTML = `
            <label for="${inputId}"${titleValue}>${nalName} - ${field.name}:</label>
            <input type="text" id="${inputId}" data-nal-type="${nalType}" data-field-name="${field.name}" data-field-index="${index}" data-original-value="${field.value}" data-field-type="${field.type}" data-field-bits="${field.bits || ''}" value="${field.value}" ${isReadOnly ? 'readonly style="background-color:#eee;"' : ''}>
            <span class="field-info">(${field.type}${field.bits ? `(${field.bits})` : ''})${field.comment ? ' ℹ️' : ''}</span>`;
        container.appendChild(fieldDiv);
    });

    // --- Display Payload Fields ---
    fields.forEach((field, index) => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";

        // Use a unique identifier for each input based on NAL type and field name/index
        // Sanitize name for ID: replace non-alphanumeric with underscore
        const sanitizedFieldName = field.name.replace(/\W/g, '_');
        // Append 'payload' to avoid ID collision with potential header fields of the same name
        const inputId = `nal-${nalType}-payload-${sanitizedFieldName}-${index}`;

        // Determine if field should be read-only
        const isReadOnly = field.type === 'struct' || field.type === 'ue' || field.type === 'error' ||
                           field.type === 'data' || field.type === 'complex' || field.type === 'info' ||
                           field.name === "vps_reserved_0xffff_16bits" || // Treat reserved as read-only
                           field.error || // Explicit error case
                           !['u', 'f'].includes(field.type) || // Only allow editing known simple types for now
                           ![32, 33, 34, 35].includes(nalType); // Only allow editing in VPS/SPS/PPS/AUD for now

        const displayValue = field.error ? `${field.value} (${field.error})` : field.value;
        const titleValue = field.comment ? ` title="${field.comment}"` : ''; // Add comment as tooltip

        fieldDiv.innerHTML = `
            <label for="${inputId}"${titleValue}>${nalName} - ${field.name}:</label>
            <input type="text" id="${inputId}" data-nal-type="${nalType}" data-field-name="${field.name}" data-field-index="${index}" data-original-value="${field.value}" data-field-type="${field.type}" data-field-bits="${field.bits || ''}" value="${displayValue}" ${isReadOnly ? 'readonly style="background-color:#eee;"' : ''}>
            <span class="field-info">(${field.type}${field.bits ? `(${field.bits})` : ''})${field.comment ? ' ℹ️' : ''}</span>`;
        container.appendChild(fieldDiv);
    });
}

// --- Modification and Download Logic ---

document.getElementById("downloadBtn")?.addEventListener("click", function() {
    if (!originalData) {
        alert("Original data not loaded.");
        return;
    }
    try {
        const modifiedData = modifyStream();
        if (modifiedData && modifiedData !== originalData) { // Check if modification actually happened
            const blob = new Blob([modifiedData], { type: "video/H265" }); // More specific MIME type
            const a = document.createElement("a");
            a.style.display = "none"; // Prevent visibility
            a.href = URL.createObjectURL(blob);
            a.download = "updated.h265";
            document.body.appendChild(a); // Append to body for broader browser compatibility
            a.click();
            // Clean up: Revoke object URL and remove the element
            window.URL.revokeObjectURL(a.href);
            document.body.removeChild(a);
            console.log("Download initiated with modified data.");
        } else if (modifiedData === originalData) {
             console.log("No modifications detected. Original data retained.");
             alert("No changes detected in the modifiable fields. Download cancelled.");
        } else {
             console.log("Modification failed or resulted in no changes.");
             alert("Modification failed or resulted in no changes. Check console.");
        }
    } catch (error) {
        console.error("Error during modification or download:", error);
        alert(`Error: ${error.message}. Check console for details.`);
    }
});

function modifyStream() {
    if (!originalData) {
        console.error("Cannot modify: Original data is null.");
        return null;
    }

    // Create a copy to modify - essential!
    // IMPORTANT: We need to create a buffer large enough for potential *future* size changes,
    // although this simple implementation DOES NOT currently handle size changes.
    // For now, stick to the original size.
    const modifiedBuffer = new ArrayBuffer(originalData.length);
    const modifiedData = new Uint8Array(modifiedBuffer);
    modifiedData.set(originalData);

    let modified = false; // Flag to track if any changes were made

    // --- VERY IMPORTANT CAVEATS ---
    // 1. This modification process RE-FINDS NAL units. It assumes the *structure*
    //    (NAL unit locations and lengths) hasn't changed. This is only safe if
    //    the modifications *don't change the size* of any NAL unit (e.g., editing
    //    fixed-length fields, but not Exp-Golomb fields). Modifying variable-length
    //    fields WILL CORRUPT THE STREAM with this code.
    // 2. It uses the SAME simplified logic as `extractFields` for modification.
    //    This means it ONLY reliably modifies the specific bits targeted by that
    //    logic (like vps_video_parameter_set_id, vps_max_sub_layers_minus1, etc.).
    //    Modifying other fields using this direct byte/bit manipulation without proper
    //    RBSP/bitstream handling WILL LIKELY CORRUPT THE H.265 STREAM.
    // 3. This does *not* handle RBSP emulation prevention bytes (0x000003 -> 0x0000 and back).
    //    Modifying data might require adding/removing these bytes, which changes NAL unit size.
    // 4. Only integer modification is supported for simplicity for 'u' type fields.
    // --- ---

    let nalStartByteOffset = -1; // Offset in the *originalData* / *modifiedData* array where the NAL unit *payload* starts
    let nalUnitStartCodeLen = 0; // Length of the start code for the current NAL unit
    let zeroCount = 0;
    let nalUnitIndex = 0; // Keep track of NAL units processed for matching UI elements (Still fragile)

    for (let i = 0; i < originalData.length; i++) {
        if (zeroCount >= 2 && originalData[i] === 1) {
            const currentStartCodeLen = zeroCount === 2 ? 3 : 4;
            // Offset where the NAL unit *data* (including header) starts in originalData
            const currentNalUnitStartOffset = i - currentStartCodeLen + 1;

            if (nalStartByteOffset !== -1) {
                // Process the *previous* NAL unit found
                // Calculate start of NAL header in originalData
                const nalHeaderOffset = nalStartByteOffset - nalUnitStartCodeLen;
                const nalUnitLength = currentNalUnitStartOffset - nalHeaderOffset; // Length including header

                if (applyModificationsToNal(modifiedData, nalHeaderOffset, nalUnitLength, nalUnitIndex)) {
                    modified = true;
                }
                nalUnitIndex++;
            }
            // Start of the new NAL unit payload (immediately after the start code)
            nalStartByteOffset = i + 1;
            nalUnitStartCodeLen = currentStartCodeLen;
            zeroCount = 0;
        } else if (originalData[i] === 0) {
            zeroCount++;
        } else {
            zeroCount = 0;
        }
    }

    // Process the last NAL unit
    if (nalStartByteOffset !== -1) {
         const nalHeaderOffset = nalStartByteOffset - nalUnitStartCodeLen;
         const lastNalUnitLength = originalData.length - nalHeaderOffset;
         if (applyModificationsToNal(modifiedData, nalHeaderOffset, lastNalUnitLength, nalUnitIndex)) {
             modified = true;
         }
    }


    return modified ? modifiedData : originalData; // Return modified only if changes were applied
}

// Helper function to apply modifications to a single NAL unit within the modifiedData buffer
function applyModificationsToNal(modifiedData, nalUnitOffset, nalUnitLength, nalUnitIndex) {
    if (nalUnitLength < 2) return false; // Need header

    let changed = false;
    const headerByte1 = modifiedData[nalUnitOffset];
    // Extract NAL type (bits 6-1 of the first header byte)
    const nalType = (headerByte1 & 0x7E) >> 1;
    const payloadOffset = nalUnitOffset + 2; // Offset of payload within modifiedData buffer
    const payloadLength = nalUnitLength - 2;

    if (payloadLength < 0) {
         console.warn(`NAL Unit type ${nalType} at offset ${nalUnitOffset} has invalid payload length (${payloadLength}). Skipping modification.`);
         return false;
    }

    // Find corresponding input fields for this NAL type *payload*
    // This still assumes the order matches the DOM order, which is fragile.
    // Select only payload fields for modification (ignoring header fields displayed)
    const potentialInputs = document.querySelectorAll(`#fieldsContainer input[data-nal-type="${nalType}"][id^="nal-${nalType}-payload-"]`);

    // Rough check if these inputs belong to the current nalUnitIndex (extremely fragile assumption)
    // A better system would store NAL unit metadata with the input elements.
    // For now, apply changes to all matching fields found. If multiple NALs of the
    // same type exist, changing one UI field will attempt to change it in all of them.

    potentialInputs.forEach(input => {
        // Check if this input field logically belongs to the current NAL unit index
        // This requires knowing how many fields each NAL type generates, which is complex.
        // --> Skipping this index check for now and applying to all matched inputs.
        // const fieldIndexInDOM = parseInt(input.dataset.fieldIndex, 10);
        // if (/* logic to map nalUnitIndex to expected fieldIndexInDOM range */) { ... }

        const fieldName = input.dataset.fieldName;
        const originalValueStr = input.dataset.originalValue; // Value originally extracted
        const currentValueStr = input.value; // Current value in the input box
        const fieldType = input.dataset.fieldType;
        const fieldBits = parseInt(input.dataset.fieldBits, 10) || 0;

        // Only proceed if the value has actually changed from the original display AND is not read-only/placeholder
        if (currentValueStr === originalValueStr || input.readOnly || originalValueStr === "..." || !fieldName) {
            return;
        }

        // Attempt to parse the new value based on expected type (currently just integer)
        let newValue;
        if (fieldType === 'u' || fieldType === 'f') { // Treat fixed as potentially numeric for bitwise ops
             newValue = parseInt(currentValueStr, 10);
             if (isNaN(newValue)) {
                 console.warn(`Invalid integer input "${currentValueStr}" for ${fieldName} (NAL Type ${nalType}). Skipping modification.`);
                 input.value = originalValueStr; // Revert UI to original value
                 return;
             }
        } else {
             console.warn(`Modification for field type '${fieldType}' not supported (${fieldName}). Skipping.`);
             input.value = originalValueStr; // Revert UI
             return;
        }


        // --- Simplified Modification Logic (Matches extraction limitations) ---
        // --- WARNING: HIGH RISK OF CORRUPTION IF MODIFYING INCORRECTLY ---
        // --- WARNING: DOES NOT HANDLE RBSP ANTI-EMULATION ---
        // --- WARNING: Modifying one field might affect others if bits overlap or bytes are shared ---
        try {
            let fieldModified = false;
            // Check payload length before accessing bytes
            if (payloadLength < 1) {
                 console.warn(`Payload too short (${payloadLength} bytes) to modify field ${fieldName} in NAL ${nalType}. Skipping.`);
                 input.value = originalValueStr; // Revert UI
                 return;
            }

            // --- VPS Modification Logic (nalType 32) ---
            if (nalType === 32) {
                // Calculate byte and bit offsets based *only* on the simplified field list order
                if (fieldName === "vps_video_parameter_set_id") { // u(4) @ byte 0, bits 7-4
                    if (newValue >= 0 && newValue <= 15) {
                        modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-15).`); }
                } else if (fieldName === "vps_base_layer_internal_flag") { // u(1) @ byte 0, bit 3
                    if (newValue === 0 || newValue === 1) {
                        modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 3)) | ((newValue & 0x01) << 3);
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-1).`); }
                } else if (fieldName === "vps_base_layer_available_flag") { // u(1) @ byte 0, bit 2
                     if (newValue === 0 || newValue === 1) {
                         modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 2)) | ((newValue & 0x01) << 2);
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-1).`); }
                } else if (fieldName === "vps_max_layers_minus1") { // u(6) @ byte 0 bits 1-0, byte 1 bits 7-4
                     if (payloadLength >= 2 && newValue >= 0 && newValue <= 63) {
                         const val_byte0_bits = (newValue >> 4) & 0x03; // Upper 2 bits of value -> lower 2 bits of byte 0
                         const val_byte1_bits = (newValue & 0x0F) << 4; // Lower 4 bits of value -> upper 4 bits of byte 1
                         modifiedData[payloadOffset]     = (modifiedData[payloadOffset] & 0xFC) | val_byte0_bits;
                         modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0x0F) | val_byte1_bits;
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} (0-63) or payload too short (${payloadLength}<2) for ${fieldName}.`); }
                } else if (fieldName === "vps_max_sub_layers_minus1") { // u(3) @ byte 1, bits 3-1
                    if (payloadLength >= 2 && newValue >= 0 && newValue <= 7) {
                        modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xF1) | ((newValue & 0x07) << 1); // Mask: 1111 0001
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} (0-7) or payload too short (${payloadLength}<2) for ${fieldName}.`); }
                } else if (fieldName === "vps_temporal_id_nesting_flag") { // u(1) @ byte 1, bit 0
                    if (payloadLength >= 2 && (newValue === 0 || newValue === 1)) {
                        modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xFE) | (newValue & 0x01); // Mask: 1111 1110
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} (0-1) or payload too short (${payloadLength}<2) for ${fieldName}.`); }
                }
                // Note: vps_reserved_0xffff_16bits is read-only
            }
            // --- SPS Modification Logic (nalType 33) ---
            else if (nalType === 33) {
                 if (fieldName === "sps_video_parameter_set_id") { // u(4) @ byte 0, bits 7-4
                    if (newValue >= 0 && newValue <= 15) {
                        modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-15).`); }
                } else if (fieldName === "sps_max_sub_layers_minus1") { // u(3) @ byte 0, bits 3-1
                     if (newValue >= 0 && newValue <= 7) {
                         modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xF1) | ((newValue & 0x07) << 1); // Mask: 1111 0001
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-7).`); }
                } else if (fieldName === "sps_temporal_id_nesting_flag") { // u(1) @ byte 0, bit 0
                    if (newValue === 0 || newValue === 1) {
                        modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFE) | (newValue & 0x01); // Mask: 1111 1110
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-1).`); }
                }
                 // Other SPS fields are complex (profile_tier_level, ue(v)) and not modifiable here
            }
            // --- PPS Modification Logic (nalType 34) ---
            // (No simple fields implemented here yet for modification - all start with ue(v))

            // --- AUD Modification Logic (nalType 35) ---
            else if (nalType === 35) {
                if (fieldName === "pic_type") { // u(3) @ byte 0, bits 7-5
                    if (newValue >= 0 && newValue <= 7) {
                        modifiedData[payloadOffset] = (newValue << 5) | (modifiedData[payloadOffset] & 0x1F); // Mask: 0001 1111
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-7).`); }
                }
            }

            // --- Update state if modification occurred ---
            if (fieldModified) {
                console.log(`Modified NAL ${nalType} (offset ${nalUnitOffset}) field "${fieldName}" to ${newValue}`);
                // Update the input's original value dataset to prevent re-applying the same change
                // and to allow further edits from the new value.
                input.dataset.originalValue = currentValueStr;
                changed = true; // Mark that *some* change happened in this NAL unit
            } else if (!input.readOnly && originalValueStr !== "...") {
                // If modification wasn't handled (e.g., field not in the logic above) or failed validation, revert the input field
                 if (!fieldName.includes("ERROR") && !fieldName.includes("Note") && !fieldName.includes("...") && fieldType !== 'struct' && fieldType !== 'ue') {
                     // Only warn/revert for fields we *might* have expected to modify
                     console.warn(`Modification not implemented or failed for NAL ${nalType}, field "${fieldName}". Reverting input.`);
                     input.value = originalValueStr;
                 }
            }

        } catch (e) {
            console.error(`Error applying modification for NAL ${nalType}, field ${fieldName}:`, e);
            input.value = originalValueStr; // Revert input on error
        }
    });

    return changed; // Return true if any field within this NAL unit was successfully changed
}
