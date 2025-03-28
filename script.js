
const version = 4
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

    // H.265 NAL Unit Header (2 bytes)
    const headerByte1 = nalUnitData[0];
    const headerByte2 = nalUnitData[1];

    // forbidden_zero_bit: f(1) (bit 0) - Should be 0
    const forbiddenZeroBit = (headerByte1 >> 7) & 0x01;
    // nal_unit_type: u(6) (bits 6-1)
    const nalType = (headerByte1 & 0x7E) >> 1;
    // nuh_layer_id: u(6) (bits 5-0 of byte 2, combined with bit 0 of byte 1)
    const nuhLayerId = ((headerByte1 & 0x01) << 5) | ((headerByte2 >> 3) & 0x1F);
    // nuh_temporal_id_plus1: u(3) (bits 2-0 of byte 2)
    const nuhTemporalIdPlus1 = headerByte2 & 0x07;

    const nalName = getNALName(nalType);

    if (forbiddenZeroBit !== 0) {
        console.warn(`Forbidden zero bit is not zero (${forbiddenZeroBit}) for NAL Unit ${nalName} (${nalType}).`);
    }
    if (nuhTemporalIdPlus1 === 0) {
        console.warn(`Temporal ID Plus 1 is zero for NAL Unit ${nalName} (${nalType}), which is invalid.`);
    }

    // The NAL unit payload (RBSP) starts after the 2-byte header.
    const payloadData = nalUnitData.subarray(2);

    // Extract fields based on NAL type
    const fields = extractFields(nalType, payloadData);

    // Display the extracted fields
    if (fields.length > 0) {
        displayFields(nalName, nalType, fields);
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
    if (nalType >= 24 && nalType <= 31) return `RSV_NVCL (${nalType})`;
    if (nalType >= 41 && nalType <= 47) return `RSV_NVCL (${nalType})`;
    if (nalType >= 48 && nalType <= 63) return `UNSPEC (${nalType})`;

    return nalMap[nalType] || `Reserved/Unknown (${nalType})`;
}

function extractFields(nalType, payloadData) {
    // --- IMPORTANT ---
    // This function provides a VERY simplified extraction for specific fields
    // in VPS/SPS/PPS based on direct byte access *without* proper RBSP handling
    // (emulation prevention byte removal) or bitstream parsing (like Exp-Golomb).
    // This will be inaccurate for many fields and potentially incorrect if
    // emulation prevention bytes (0x03) are present.
    // --- ---
    let fields = [];

    if (payloadData.length < 1) {
       // console.warn(`NAL unit payload empty for NAL Type ${nalType}. Cannot extract fields.`);
       return fields;
    }

    try {
        if (nalType === 32) { // VPS_NUT (Video Parameter Set - ITU-T H.265 Section 7.3.2.1)
            // vps_video_parameter_set_id: u(4) -> Upper 4 bits of the first payload byte (byte 0)
            fields.push({ name: "vps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F, bits: 4, type: 'u' });

            // vps_base_layer_internal_flag: u(1) -> Bit 3 of byte 0
            fields.push({ name: "vps_base_layer_internal_flag", value: (payloadData[0] >> 3) & 0x01, bits: 1, type: 'u' });

            // vps_base_layer_available_flag: u(1) -> Bit 2 of byte 0
            fields.push({ name: "vps_base_layer_available_flag", value: (payloadData[0] >> 2) & 0x01, bits: 1, type: 'u' });

             // vps_max_layers_minus1: u(6) -> Bits 1-0 of byte 0, and bits 7-4 of byte 1
             if (payloadData.length >= 2) {
                const val_byte0 = (payloadData[0] & 0x03); // Lower 2 bits
                const val_byte1 = (payloadData[1] >> 4) & 0x0F; // Upper 4 bits
                const vps_max_layers_minus1 = (val_byte0 << 4) | val_byte1;
                fields.push({ name: "vps_max_layers_minus1", value: vps_max_layers_minus1, bits: 6, type: 'u'});
             } else {
                fields.push({ name: "vps_max_layers_minus1", value: "...", bits: 6, type: 'u', error: 'Payload too short'}); // Indicate insufficient data
             }

            // vps_max_sub_layers_minus1: u(3) -> bits 3-1 of byte 1
            if (payloadData.length >= 2) {
                fields.push({ name: "vps_max_sub_layers_minus1", value: (payloadData[1] >> 1) & 0x07, bits: 3, type: 'u' });
            } else {
                fields.push({ name: "vps_max_sub_layers_minus1", value: "...", bits: 3, type: 'u', error: 'Payload too short'});
            }

            // vps_temporal_id_nesting_flag: u(1) -> bit 0 of byte 1
             if (payloadData.length >= 2) {
                fields.push({ name: "vps_temporal_id_nesting_flag", value: payloadData[1] & 0x01, bits: 1, type: 'u' });
             } else {
                 fields.push({ name: "vps_temporal_id_nesting_flag", value: "...", bits: 1, type: 'u', error: 'Payload too short'});
             }

             // vps_reserved_0xffff_16bits: f(16) -> Bytes 2 and 3 (assuming byte alignment for simplicity)
             if (payloadData.length >= 4) {
                 fields.push({ name: "vps_reserved_0xffff_16bits", value: `0x${payloadData[2].toString(16).padStart(2, '0')}${payloadData[3].toString(16).padStart(2, '0')}`, bits: 16, type: 'f' }); // Simplified display
             } else {
                 fields.push({ name: "vps_reserved_0xffff_16bits", value: "...", bits: 16, type: 'f', error: 'Payload too short' });
             }

             // profile_tier_level structure follows - complex parsing needed
             fields.push({ name: "profile_tier_level", value: "...", type: 'struct' }); // Placeholder


        } else if (nalType === 33) { // SPS_NUT (Sequence Parameter Set - ITU-T H.265 Section 7.3.2.2)
            // sps_video_parameter_set_id: u(4) -> Upper 4 bits of the first payload byte
            fields.push({ name: "sps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F, bits: 4, type: 'u' });
            // sps_max_sub_layers_minus1: u(3) -> Next 3 bits (bits 3-1 of byte 0)
            fields.push({ name: "sps_max_sub_layers_minus1", value: (payloadData[0] >> 1) & 0x07, bits: 3, type: 'u' });
            // sps_temporal_id_nesting_flag: u(1) -> Next 1 bit (bit 0 of byte 0)
            fields.push({ name: "sps_temporal_id_nesting_flag", value: payloadData[0] & 0x01, bits: 1, type: 'u' });
            // profile_tier_level(...) structure follows - complex parsing needed
            fields.push({ name: "profile_tier_level", value: "...", type: 'struct' }); // Placeholder
            // sps_seq_parameter_set_id: ue(v) -> Requires Exp-Golomb decoding, starts after profile_tier_level
            fields.push({ name: "sps_seq_parameter_set_id", value: "...", type: 'ue'}); // Placeholder - requires proper parsing
            // Add more SPS fields as placeholders if needed...
            fields.push({ name: "chroma_format_idc", value: "...", type: 'ue'}); // Placeholder
            // ... other fields ...

        } else if (nalType === 34) { // PPS_NUT (Picture Parameter Set - ITU-T H.265 Section 7.3.2.3)
             // pps_pic_parameter_set_id: ue(v) -> Requires Exp-Golomb decoding
             // pps_seq_parameter_set_id: ue(v) -> Requires Exp-Golomb decoding
            fields.push({ name: "pps_pic_parameter_set_id", value: "...", type: 'ue'}); // Placeholder - requires proper parsing
            fields.push({ name: "pps_seq_parameter_set_id", value: "...", type: 'ue'}); // Placeholder - requires proper parsing
            // Add more PPS fields as placeholders if needed...
            fields.push({ name: "dependent_slice_segments_enabled_flag", value: "...", type: 'u', bits: 1}); // Placeholder
             // ... other fields ...
        }
        // Add extraction logic for other NAL types if needed (e.g., AUD, SEI)
    } catch (e) {
        console.error(`Error parsing NAL unit type ${nalType}:`, e);
        // Add a field indicating the error
        fields.push({ name: "PARSING_ERROR", value: e.message || "Unknown Error", type: "error" });
    }
    return fields;
}

function displayFields(nalName, nalType, fields) {
    const container = document.getElementById("fieldsContainer");
    if (!container) return;

    fields.forEach((field, index) => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";

        // Use a unique identifier for each input based on NAL type and field name/index
        const inputId = `nal-${nalType}-field-${field.name.replace(/\W/g, '_')}-${index}`; // Sanitize name for ID

        const isReadOnly = field.type === 'struct' || field.type === 'ue' || field.type === 'error' || field.name === "vps_reserved_0xffff_16bits" || field.error; // Make complex/placeholder/error fields read-only
        const displayValue = field.error ? `${field.value} (${field.error})` : field.value;

        fieldDiv.innerHTML = `
            <label for="${inputId}">${nalName} - ${field.name}:</label>
            <input type="text" id="${inputId}" data-nal-type="${nalType}" data-field-name="${field.name}" data-field-index="${index}" data-original-value="${field.value}" value="${displayValue}" ${isReadOnly ? 'readonly style="background-color:#eee;"' : ''}>
            <span class="field-info">(${field.type}${field.bits ? `(${field.bits})` : ''})</span>`;
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
    const modifiedBuffer = new ArrayBuffer(originalData.length);
    const modifiedData = new Uint8Array(modifiedBuffer);
    modifiedData.set(originalData);

    let modified = false; // Flag to track if any changes were made

    // --- VERY IMPORTANT CAVEATS ---
    // 1. This modification process RE-FINDS NAL units. It assumes the *structure*
    //    (NAL unit locations and lengths) hasn't changed. This is only safe if
    //    the modifications *don't change the size* of any NAL unit (e.g., editing
    //    fixed-length fields, but not Exp-Golomb fields).
    // 2. It uses the SAME simplified logic as `extractFields` for modification.
    //    This means it ONLY reliably modifies the specific bits targeted by that
    //    logic (like vps_video_parameter_set_id, vps_max_layers_minus1, etc.). Modifying other
    //    fields using this direct byte/bit manipulation without proper RBSP/bitstream
    //    handling WILL LIKELY CORRUPT THE H.265 STREAM.
    // 3. This does *not* handle emulation prevention bytes (0x000003). Inserting
    //    or removing bytes would require shifting subsequent data and recalculating offsets.
    // 4. Only integer modification is supported for simplicity.
    // --- ---

    let nalStartByteOffset = -1; // Offset in the *originalData* / *modifiedData* array where the NAL unit *payload* starts
    let nalUnitStartCodeLen = 0; // Length of the start code for the current NAL unit
    let zeroCount = 0;

    for (let i = 0; i < originalData.length; i++) {
        if (zeroCount >= 2 && originalData[i] === 1) {
            const currentStartCodeLen = zeroCount === 2 ? 3 : 4;
            const currentNalUnitStartOffset = i - currentStartCodeLen + 1; // Offset where the NAL unit *data* (including header) starts

            if (nalStartByteOffset !== -1) {
                // Process the *previous* NAL unit found
                const nalHeaderOffset = nalStartByteOffset - nalUnitStartCodeLen; // Calculate start of NAL header
                const nalUnitLength = currentNalUnitStartOffset - nalHeaderOffset; // Length including header

                if (applyModificationsToNal(modifiedData, nalHeaderOffset, nalUnitLength)) {
                    modified = true;
                }
            }
            // Start of the new NAL unit (immediately after the start code)
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
         if (applyModificationsToNal(modifiedData, nalHeaderOffset, lastNalUnitLength)) {
             modified = true;
         }
    }


    return modified ? modifiedData : originalData; // Return modified only if changes were applied
}

// Helper function to apply modifications to a single NAL unit within the modifiedData buffer
function applyModificationsToNal(modifiedData, nalUnitOffset, nalUnitLength) {
    if (nalUnitLength < 2) return false; // Need header

    let changed = false;
    const headerByte1 = modifiedData[nalUnitOffset];
    // Extract NAL type (bits 6-1 of the first header byte)
    const nalType = (headerByte1 & 0x7E) >> 1;
    const payloadOffset = nalUnitOffset + 2; // Offset of payload within modifiedData
    const payloadLength = nalUnitLength - 2;

    if (payloadLength < 0) {
         console.warn(`NAL Unit type ${nalType} at offset ${nalUnitOffset} has invalid payload length (${payloadLength}). Skipping modification.`);
         return false;
    }

    // Find corresponding input fields for this NAL type
    const inputs = document.querySelectorAll(`#fieldsContainer input[data-nal-type="${nalType}"]`);

    inputs.forEach(input => {
        const fieldName = input.dataset.fieldName;
        const originalValueStr = input.dataset.originalValue; // Value originally extracted
        const currentValueStr = input.value; // Current value in the input box

        // Only proceed if the value has actually changed from the original display AND is not read-only/placeholder
        if (currentValueStr === originalValueStr || input.readOnly || originalValueStr === "...") {
            // console.log(`Skipping ${fieldName} - no change or read-only.`);
            return;
        }

        // Attempt to parse the new value as an integer (basic validation)
        const newValue = parseInt(currentValueStr, 10);
        if (isNaN(newValue)) {
            console.warn(`Invalid input "${currentValueStr}" for ${fieldName} (NAL Type ${nalType}). Skipping modification.`);
            input.value = originalValueStr; // Revert UI to original value
            return;
        }

        // --- Simplified Modification Logic (Matches extraction limitations) ---
        // --- WARNING: HIGH RISK OF CORRUPTION IF MODIFYING INCORRECTLY ---
        try {
            let fieldModified = false;
            // --- VPS Modification Logic (nalType 32) ---
            if (nalType === 32) {
                if (fieldName === "vps_video_parameter_set_id") {
                    if (payloadLength >= 1 && newValue >= 0 && newValue <= 15) { // u(4)
                        // Modify the upper 4 bits of the first payload byte
                        modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                        fieldModified = true;
                    } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-15) or payload too short (${payloadLength}).`); }
                } else if (fieldName === "vps_base_layer_internal_flag") {
                    if (payloadLength >= 1 && (newValue === 0 || newValue === 1)) { // u(1)
                        // Modify bit 3 of the first payload byte
                        modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 3)) | ((newValue & 0x01) << 3);
                        fieldModified = true;
                    } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-1) or payload too short (${payloadLength}).`); }
                } else if (fieldName === "vps_base_layer_available_flag") {
                     if (payloadLength >= 1 && (newValue === 0 || newValue === 1)) { // u(1)
                         // Modify bit 2 of the first payload byte
                         modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 2)) | ((newValue & 0x01) << 2);
                         fieldModified = true;
                     } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-1) or payload too short (${payloadLength}).`); }
                } else if (fieldName === "vps_max_layers_minus1") {
                     if (payloadLength >= 2 && newValue >= 0 && newValue <= 63) { // u(6) spans byte 0 and 1
                         // Bits 1-0 of byte 0, Bits 7-4 of byte 1
                         const val_byte0_bits = (newValue >> 4) & 0x03; // Upper 2 bits of value go to lower 2 bits of byte 0
                         const val_byte1_bits = (newValue & 0x0F) << 4; // Lower 4 bits of value go to upper 4 bits of byte 1

                         // Modify byte 0 (payloadOffset): Clear bits 1-0, set new bits
                         modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFC) | val_byte0_bits;
                         // Modify byte 1 (payloadOffset + 1): Clear bits 7-4, set new bits
                         modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0x0F) | val_byte1_bits;
                         fieldModified = true;
                     } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-63) or payload too short (${payloadLength}).`); }
                } else if (fieldName === "vps_max_sub_layers_minus1") {
                    if (payloadLength >= 2 && newValue >= 0 && newValue <= 7) { // u(3) in byte 1
                        // Modify bits 3-1 of the second payload byte (at payloadOffset + 1)
                        modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xF1) | ((newValue & 0x07) << 1);
                        fieldModified = true;
                    } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-7) or payload too short (${payloadLength}).`); }
                } else if (fieldName === "vps_temporal_id_nesting_flag") {
                    if (payloadLength >= 2 && (newValue === 0 || newValue === 1)) { // u(1) in byte 1
                        // Modify bit 0 of the second payload byte (at payloadOffset + 1)
                        modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xFE) | (newValue & 0x01);
                        fieldModified = true;
                    } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-1) or payload too short (${payloadLength}).`); }
                }
            }
            // --- SPS Modification Logic (nalType 33) ---
            else if (nalType === 33) {
                if (fieldName === "sps_video_parameter_set_id") {
                    if (payloadLength >= 1 && newValue >= 0 && newValue <= 15) { // u(4)
                        // Modify the upper 4 bits of the first payload byte
                        modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                        fieldModified = true;
                    } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-15) or payload too short (${payloadLength}).`); }
                } else if (fieldName === "sps_max_sub_layers_minus1") {
                     if (payloadLength >= 1 && newValue >= 0 && newValue <= 7) { // u(3)
                         // Modify bits 3-1 of the first payload byte
                         modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xF1) | ((newValue & 0x07) << 1);
                         fieldModified = true;
                     } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-7) or payload too short (${payloadLength}).`); }
                } else if (fieldName === "sps_temporal_id_nesting_flag") {
                    if (payloadLength >= 1 && (newValue === 0 || newValue === 1)) { // u(1)
                        // Modify bit 0 of the first payload byte
                        modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFE) | (newValue & 0x01);
                        fieldModified = true;
                    } else { console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (0-1) or payload too short (${payloadLength}).`); }
                }
            }
            // --- PPS Modification Logic (nalType 34) ---
            // (No simple fields implemented here yet for modification)

            // --- Update state if modification occurred ---
            if (fieldModified) {
                console.log(`Modified NAL ${nalType} field "${fieldName}" at payload offset ${payloadOffset} (approx) to ${newValue}`);
                input.dataset.originalValue = currentValueStr; // Update original value tracking AFTER successful modification
                changed = true; // Mark that *some* change happened in this NAL unit
            } else if (!input.readOnly && originalValueStr !== "...") {
                // If modification wasn't handled or failed validation, revert the input field
                console.warn(`Modification not implemented or failed for NAL ${nalType}, field "${fieldName}". Reverting input.`);
                input.value = originalValueStr;
            }

        } catch (e) {
            console.error(`Error applying modification for NAL ${nalType}, field ${fieldName}:`, e);
            input.value = originalValueStr; // Revert input on error
        }
    });

    return changed; // Return true if any field within this NAL unit was successfully changed
}
