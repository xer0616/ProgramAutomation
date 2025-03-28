
const version = 2
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

            // --- The following are illustrative and likely incorrect due to simplified parsing ---
            // vps_base_layer_internal_flag: u(1) -> bit 3
            // vps_base_layer_available_flag: u(1) -> bit 2
            // vps_max_layers_minus1: u(6) -> bits 1-0 of byte 0, bits 7-4 of byte 1 (requires cross-byte read)
            // vps_max_sub_layers_minus1: u(3) -> bits 3-1 of byte 1
            // vps_temporal_id_nesting_flag: u(1) -> bit 0 of byte 1
             if (payloadData.length >= 2) {
                 // fields.push({ name: "vps_base_layer_internal_flag", value: (payloadData[0] >> 3) & 0x01 }); // Example
                 // fields.push({ name: "vps_base_layer_available_flag", value: (payloadData[0] >> 2) & 0x01 }); // Example
                 fields.push({ name: "vps_max_sub_layers_minus1", value: (payloadData[1] >> 1) & 0x07, bits: 3, type: 'u' }); // Approx based on simple parsing
                 fields.push({ name: "vps_temporal_id_nesting_flag", value: payloadData[1] & 0x01, bits: 1, type: 'u' }); // Approx based on simple parsing
             }
        } else if (nalType === 33) { // SPS_NUT (Sequence Parameter Set)
            // sps_video_parameter_set_id: u(4) -> Upper 4 bits of the first payload byte
            fields.push({ name: "sps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F, bits: 4, type: 'u' });
            // sps_max_sub_layers_minus1: u(3) -> Next 3 bits (bits 3-1 of byte 0)
            fields.push({ name: "sps_max_sub_layers_minus1", value: (payloadData[0] >> 1) & 0x07, bits: 3, type: 'u' });
            // sps_temporal_id_nesting_flag: u(1) -> Next 1 bit (bit 0 of byte 0)
            fields.push({ name: "sps_temporal_id_nesting_flag", value: payloadData[0] & 0x01, bits: 1, type: 'u' });
            // sps_seq_parameter_set_id: ue(v) -> Requires Exp-Golomb decoding, starts later
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
        const inputId = `nal-${nalType}-field-${field.name}-${index}`;

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
        if (modifiedData) {
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
            console.log("Download initiated.");
        } else {
             console.log("No modifications detected or modification failed.");
             alert("Modification failed or no data to modify. Check console.");
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
    //    logic (like the 4 bits for vps_video_parameter_set_id). Modifying other
    //    fields using this direct byte/bit manipulation without proper RBSP/bitstream
    //    handling WILL LIKELY CORRUPT THE H.265 STREAM.
    // 3. This does *not* handle emulation prevention bytes (0x000003). Inserting
    //    or removing bytes would require shifting subsequent data and recalculating offsets.
    // --- ---

    let currentNalStartOffset = -1; // Offset in the *originalData* array
    let zeroCount = 0;

    for (let i = 0; i < originalData.length; i++) {
        if (zeroCount >= 2 && originalData[i] === 1) {
            const startCodeLen = zeroCount === 2 ? 3 : 4;
            const nalHeaderOffset = i + 1 - startCodeLen; // Offset of the first byte *after* the start code in originalData

            if (currentNalStartOffset !== -1) {
                // Modify the *previous* NAL unit found
                if (applyModificationsToNal(modifiedData, currentNalStartOffset, nalHeaderOffset - currentNalStartOffset)) {
                    modified = true;
                }
            }
            // Start of the new NAL unit's data (after start code)
            currentNalStartOffset = nalHeaderOffset;
            zeroCount = 0;
        } else if (originalData[i] === 0) {
            zeroCount++;
        } else {
            zeroCount = 0;
        }
    }

    // Process the last NAL unit
    if (currentNalStartOffset !== -1) {
         if (applyModificationsToNal(modifiedData, currentNalStartOffset, originalData.length - currentNalStartOffset)) {
             modified = true;
         }
    }


    return modified ? modifiedData : originalData; // Return modified only if changes were applied
}

// Helper function to apply modifications to a single NAL unit within the modifiedData buffer
function applyModificationsToNal(modifiedData, nalDataOffset, nalDataLength) {
    if (nalDataLength < 2) return false; // Need header

    let changed = false;
    const headerByte1 = modifiedData[nalDataOffset];
    const nalType = (headerByte1 & 0x7E) >> 1;
    const payloadOffset = nalDataOffset + 2; // Offset of payload within modifiedData
    const payloadLength = nalDataLength - 2;

    // Find corresponding input fields for this NAL type
    const inputs = document.querySelectorAll(`#fieldsContainer input[data-nal-type="${nalType}"]`);

    inputs.forEach(input => {
        const fieldName = input.dataset.fieldName;
        const originalValueStr = input.dataset.originalValue;
        const currentValueStr = input.value;

        // Only proceed if the value has actually changed from the original display
        if (currentValueStr === originalValueStr) {
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
                    console.warn(`Cannot modify ${fieldName}: Invalid value or payload too short.`);
                    input.value = originalValueStr;
                 }
            } else if (nalType === 33 && fieldName === "sps_video_parameter_set_id") {
                if (payloadLength >= 1 && newValue >= 0 && newValue <= 15) { // u(4)
                    modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                    console.log(`Modified SPS VPS ID at offset ${payloadOffset} to ${newValue}`);
                    input.dataset.originalValue = currentValueStr;
                    changed = true;
                } else {
                    console.warn(`Cannot modify ${fieldName}: Invalid value or payload too short.`);
                    input.value = originalValueStr;
                }
            } else if (nalType === 33 && fieldName === "sps_max_sub_layers_minus1") {
                 if (payloadLength >= 1 && newValue >= 0 && newValue <= 7) { // u(3)
                     // Modify bits 3-1 of the first payload byte
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xF1) | ((newValue & 0x07) << 1);
                     console.log(`Modified SPS Max Sub Layers at offset ${payloadOffset} to ${newValue}`);
                     input.dataset.originalValue = currentValueStr;
                     changed = true;
                 } else {
                     console.warn(`Cannot modify ${fieldName}: Invalid value or payload too short.`);
                     input.value = originalValueStr;
                 }
            }
            // *** ADD MODIFICATION LOGIC FOR OTHER FIELDS HERE ***
            // !!! WARNING: Requires extreme care due to simplified parsing !!!
            // !!! Modifying fields parsed as "..." (Exp-Golomb) is NOT supported here !!!
            else {
                 // If the field is one of the placeholders or unsupported ones, revert the input
                 if (input.value !== "...") {
                      console.warn(`Modification for field "${fieldName}" (NAL Type ${nalType}) is not supported by this simple script. Reverting change.`);
                      input.value = originalValueStr;
                 }
            }

        } catch (e) {
            console.error(`Error applying modification for NAL ${nalType}, field ${fieldName}:`, e);
            input.value = originalValueStr; // Revert on error
        }
    });

    return changed;
}
