
const version = 3
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

    // Extract nal_unit_type (bits 1-6 of the first header byte)
    const nalType = (headerByte1 & 0x7E) >> 1;
    const nalName = getNALName(nalType);

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
    // H.265 NAL Unit Types (selected common types)
    const nalMap = {
        19: "IDR_W_RADL", // Coded slice segment of an IDR picture
        20: "IDR_N_LP",   // Coded slice segment of an IDR picture
        32: "VPS_NUT",    // Video Parameter Set
        33: "SPS_NUT",    // Sequence Parameter Set
        34: "PPS_NUT",    // Picture Parameter Set
        35: "AUD_NUT",    // Access Unit Delimiter
        39: "PREFIX_SEI_NUT", // Supplemental enhancement information (SEI) prefix
        40: "SUFFIX_SEI_NUT"  // Supplemental enhancement information (SEI) suffix
        // Add other relevant types as needed (e.g., slice types 0-9, 16-21)
    };
    return nalMap[nalType] || `Reserved/Unspecified (${nalType})`;
}

function extractFields(nalType, payloadData) {
    // --- IMPORTANT ---
    // This function provides a VERY simplified extraction for specific fields
    // in VPS/SPS/PPS based on direct byte access *without* proper RBSP handling
    // (emulation prevention byte removal) or bitstream parsing (like Exp-Golomb).
    // This will be inaccurate for many fields and potentially incorrect if
    // emulation prevention bytes (0x03) are present.
    // It primarily focuses on fixing the vps_video_parameter_set_id extraction.
    // --- ---
    let fields = [];

    if (payloadData.length < 1) {
       // console.warn(`NAL unit payload empty for NAL Type ${nalType}. Cannot extract fields.`);
       return fields;
    }

    try {
        if (nalType === 32) { // VPS_NUT (Video Parameter Set)
            // vps_video_parameter_set_id: u(4) -> Upper 4 bits of the first payload byte
            fields.push({ name: "vps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F, bits: 4, type: 'u' });

            // vps_reserved_three_2bits: u(2) -> Next 2 bits (bits 3-2 of byte 0)
            // NOTE: In H.265 spec, these 2 bits correspond to:
            // vps_base_layer_internal_flag u(1) (bit 3)
            // vps_base_layer_available_flag u(1) (bit 2)
            // They are presented here as a single 2-bit field as requested.
            fields.push({ name: "vps_reserved_three_2bits", value: (payloadData[0] >> 2) & 0x03, bits: 2, type: 'u' });


            // --- The following are illustrative and likely incorrect due to simplified parsing ---
            // vps_max_layers_minus1: u(6) -> bits 1-0 of byte 0, bits 7-4 of byte 1 (requires cross-byte read)
            // vps_max_sub_layers_minus1: u(3) -> bits 3-1 of byte 1
            // vps_temporal_id_nesting_flag: u(1) -> bit 0 of byte 1
             if (payloadData.length >= 2) {
                 // fields.push({ name: "vps_max_layers_minus1", value: "...", bits: 6, type: 'u'}); // Complex, not implemented
                 fields.push({ name: "vps_max_sub_layers_minus1", value: (payloadData[1] >> 1) & 0x07, bits: 3, type: 'u' }); // Approx based on simple parsing
                 fields.push({ name: "vps_temporal_id_nesting_flag", value: payloadData[1] & 0x01, bits: 1, type: 'u' }); // Approx based on simple parsing
             }
             // Add placeholders for other complex fields
             fields.push({ name: "vps_reserved_0xffff_16bits", value: "...", bits: 16, type: 'f' }); // Placeholder
             fields.push({ name: "profile_tier_level", value: "...", type: 'struct' }); // Placeholder


        } else if (nalType === 33) { // SPS_NUT (Sequence Parameter Set)
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

        } else if (nalType === 34) { // PPS_NUT (Picture Parameter Set)
             // pps_pic_parameter_set_id: ue(v) -> Requires Exp-Golomb decoding
             // pps_seq_parameter_set_id: ue(v) -> Requires Exp-Golomb decoding
            fields.push({ name: "pps_pic_parameter_set_id", value: "...", type: 'ue'}); // Placeholder - requires proper parsing
            fields.push({ name: "pps_seq_parameter_set_id", value: "...", type: 'ue'}); // Placeholder - requires proper parsing
        }
        // Add extraction logic for other NAL types if needed
    } catch (e) {
        console.error(`Error parsing NAL unit type ${nalType}:`, e);
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
        // Using index helps differentiate if the same field name appears multiple times (though unlikely here)
        const inputId = `nal-${nalType}-field-${field.name.replace(/\W/g, '_')}-${index}`; // Sanitize name for ID

        fieldDiv.innerHTML = `
            <label for="${inputId}">${nalName} - ${field.name}:</label>
            <input type="text" id="${inputId}" data-nal-type="${nalType}" data-field-name="${field.name}" data-field-index="${index}" data-original-value="${field.value}" value="${field.value}">
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
            const blob = new Blob([modifiedData], { type: "application/octet-stream" });
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
             alert("No changes detected in the fields. Download cancelled.");
        } else {
             console.log("Modification failed.");
             alert("Modification failed. Check console.");
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
    //    (NAL unit locations and lengths) hasn't changed significantly, which might
    //    not be true if values affecting size (like Exp-Golomb) are altered.
    // 2. It uses the SAME simplified logic as `extractFields` for modification.
    //    This means it ONLY reliably modifies the specific bits targeted by that
    //    logic (like the 4 bits for vps_video_parameter_set_id or the 2 bits for vps_reserved_three_2bits). Modifying other
    //    fields using this direct byte/bit manipulation without proper RBSP/bitstream
    //    handling WILL LIKELY CORRUPT THE H.265 STREAM.
    // 3. This does *not* handle emulation prevention bytes (0x000003). Inserting
    //    or removing bytes would require shifting subsequent data and recalculating offsets.
    // --- ---

    let currentNalStartOffset = -1; // Offset in the *originalData* / *modifiedData* array where NAL header starts
    let zeroCount = 0;

    for (let i = 0; i < originalData.length; i++) {
        if (zeroCount >= 2 && originalData[i] === 1) {
            const startCodeLen = zeroCount === 2 ? 3 : 4;
            const nalUnitOffset = i + 1 - startCodeLen; // Offset of the first byte *of the NAL unit header* in originalData

            if (currentNalStartOffset !== -1) {
                // Modify the *previous* NAL unit found
                 const nalUnitLength = nalUnitOffset - currentNalStartOffset;
                if (applyModificationsToNal(modifiedData, currentNalStartOffset, nalUnitLength)) {
                    modified = true;
                }
            }
            // Start of the new NAL unit's header
            currentNalStartOffset = nalUnitOffset;
            zeroCount = 0;
        } else if (originalData[i] === 0) {
            zeroCount++;
        } else {
            zeroCount = 0;
        }
    }

    // Process the last NAL unit
    if (currentNalStartOffset !== -1) {
         const lastNalUnitLength = originalData.length - currentNalStartOffset;
         if (applyModificationsToNal(modifiedData, currentNalStartOffset, lastNalUnitLength)) {
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
    const nalType = (headerByte1 & 0x7E) >> 1;
    const payloadOffset = nalUnitOffset + 2; // Offset of payload within modifiedData
    const payloadLength = nalUnitLength - 2;

    if (payloadLength < 0) { // Should not happen if nalUnitLength >= 2, but good check
         console.warn(`NAL Unit type ${nalType} at offset ${nalUnitOffset} has negative payload length. Skipping modification.`);
         return false;
    }

    // Find corresponding input fields for this NAL type
    const inputs = document.querySelectorAll(`#fieldsContainer input[data-nal-type="${nalType}"]`);

    inputs.forEach(input => {
        const fieldName = input.dataset.fieldName;
        const originalValueStr = input.dataset.originalValue;
        const currentValueStr = input.value;

        // Only proceed if the value has actually changed from the original display
        if (currentValueStr === originalValueStr || originalValueStr === "...") { // Don't modify placeholders
            return;
        }

        // Special check for placeholders: if original was '...', don't try to parse/modify
        if (originalValueStr === "...") {
             console.warn(`Modification for placeholder field "${fieldName}" (NAL Type ${nalType}) is not supported. Reverting change.`);
             input.value = originalValueStr;
             return;
        }

        const newValue = parseInt(currentValueStr, 10); // Assuming integer values for simplicity
        if (isNaN(newValue)) {
            console.warn(`Invalid input "${currentValueStr}" for ${fieldName}. Skipping.`);
            input.value = originalValueStr; // Revert UI to original value
            return;
        }

        // --- Simplified Modification Logic (Matches extraction limitations) ---
        try {
            if (nalType === 32 && fieldName === "vps_video_parameter_set_id") {
                 if (payloadLength >= 1 && newValue >= 0 && newValue <= 15) { // u(4)
                    // Modify the upper 4 bits of the first payload byte
                    modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                    console.log(`Modified VPS ID at offset ${payloadOffset} to ${newValue}`);
                    input.dataset.originalValue = currentValueStr; // Update original value tracking
                    changed = true;
                 } else {
                    console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (must be 0-15) or payload too short (${payloadLength}).`);
                    input.value = originalValueStr;
                 }
            } else if (nalType === 32 && fieldName === "vps_reserved_three_2bits") {
                 if (payloadLength >= 1 && newValue >= 0 && newValue <= 3) { // u(2)
                    // Modify bits 3-2 of the first payload byte
                    // Clear bits 3-2: (modifiedData[payloadOffset] & 0xF3) which is (modifiedData[payloadOffset] & ~(0x03 << 2))
                    // Set new bits: ((newValue & 0x03) << 2)
                    modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xF3) | ((newValue & 0x03) << 2);
                    console.log(`Modified VPS reserved_three_2bits at offset ${payloadOffset} to ${newValue}`);
                    input.dataset.originalValue = currentValueStr; // Update original value tracking
                    changed = true;
                 } else {
                    console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (must be 0-3) or payload too short (${payloadLength}).`);
                    input.value = originalValueStr;
                 }
            } else if (nalType === 32 && fieldName === "vps_max_sub_layers_minus1") {
                if (payloadLength >= 2 && newValue >= 0 && newValue <= 7) { // u(3)
                    // Modify bits 3-1 of the second payload byte (at payloadOffset + 1)
                    // Clear bits 3-1: (modifiedData[payloadOffset+1] & 0xF1) which is (modifiedData[payloadOffset+1] & ~(0x07 << 1))
                    // Set new bits: ((newValue & 0x07) << 1)
                    modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xF1) | ((newValue & 0x07) << 1);
                    console.log(`Modified VPS Max Sub Layers at offset ${payloadOffset + 1} to ${newValue}`);
                    input.dataset.originalValue = currentValueStr;
                    changed = true;
                } else {
                    console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (must be 0-7) or payload too short (${payloadLength}).`);
                    input.value = originalValueStr;
                }
            } else if (nalType === 32 && fieldName === "vps_temporal_id_nesting_flag") {
                if (payloadLength >= 2 && (newValue === 0 || newValue === 1)) { // u(1)
                    // Modify bit 0 of the second payload byte (at payloadOffset + 1)
                    modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xFE) | (newValue & 0x01);
                    console.log(`Modified VPS Temporal ID Nesting Flag at offset ${payloadOffset + 1} to ${newValue}`);
                    input.dataset.originalValue = currentValueStr;
                    changed = true;
                } else {
                    console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (must be 0-1) or payload too short (${payloadLength}).`);
                    input.value = originalValueStr;
                }
            } else if (nalType === 33 && fieldName === "sps_video_parameter_set_id") {
                if (payloadLength >= 1 && newValue >= 0 && newValue <= 15) { // u(4)
                    // Modify the upper 4 bits of the first payload byte
                    modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                    console.log(`Modified SPS VPS ID at offset ${payloadOffset} to ${newValue}`);
                    input.dataset.originalValue = currentValueStr;
                    changed = true;
                } else {
                    console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (must be 0-15) or payload too short (${payloadLength}).`);
                    input.value = originalValueStr;
                }
            } else if (nalType === 33 && fieldName === "sps_max_sub_layers_minus1") {
                 if (payloadLength >= 1 && newValue >= 0 && newValue <= 7) { // u(3)
                     // Modify bits 3-1 of the first payload byte
                     // Clear bits 3-1: (modifiedData[payloadOffset] & 0xF1) which is (modifiedData[payloadOffset] & ~(0x07 << 1))
                     // Set new bits: ((newValue & 0x07) << 1)
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xF1) | ((newValue & 0x07) << 1);
                     console.log(`Modified SPS Max Sub Layers at offset ${payloadOffset} to ${newValue}`);
                     input.dataset.originalValue = currentValueStr;
                     changed = true;
                 } else {
                     console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (must be 0-7) or payload too short (${payloadLength}).`);
                     input.value = originalValueStr;
                 }
            } else if (nalType === 33 && fieldName === "sps_temporal_id_nesting_flag") {
                if (payloadLength >= 1 && (newValue === 0 || newValue === 1)) { // u(1)
                    // Modify bit 0 of the first payload byte
                    modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFE) | (newValue & 0x01);
                    console.log(`Modified SPS Temporal ID Nesting Flag at offset ${payloadOffset} to ${newValue}`);
                    input.dataset.originalValue = currentValueStr;
                    changed = true;
                } else {
                    console.warn(`Cannot modify ${fieldName}: Invalid value ${newValue} (must be 0-1) or payload too short (${payloadLength}).`);
                    input.value = originalValueStr;
                }
            }
            // *** ADD MODIFICATION LOGIC FOR OTHER SIMPLE FIELDS HERE ***
            // !!! WARNING: Requires extreme care due to simplified parsing !!!
            // !!! Modifying fields parsed as "..." (Exp-Golomb or structs) is NOT supported here !!!
            else {
                 // If the field is one of the placeholders or unsupported ones, revert the input
                 // This case should ideally be caught by the originalValueStr === "..." check above,
                 // but this provides an extra safety net.
                 console.warn(`Modification for field "${fieldName}" (NAL Type ${nalType}) is not supported by this simple script. Reverting change.`);
                 input.value = originalValueStr;
            }

        } catch (e) {
            console.error(`Error applying modification for NAL ${nalType}, field ${fieldName}:`, e);
            input.value = originalValueStr; // Revert on error
        }
    });

    return changed;
}
