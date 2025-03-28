
const version = 6
document.getElementById("version").innerText = version;
let originalData = null;

fetch("original.h265")
    .then(response => response.arrayBuffer())
    .then(buffer => {
        originalData = new Uint8Array(buffer);
        extractNALUnits(originalData);
    })
    .catch(error => console.error("Error loading file:", error));

function extractNALUnits(data) {
    const fieldsContainer = document.getElementById("fieldsContainer");
    fieldsContainer.innerHTML = "";
    let nalStart = -1;
    let nalEnd = -1;

    for (let i = 0; i < data.length - 3; i++) {
        // Find NAL unit start code (00 00 01 or 00 00 00 01)
        let isStartCode3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
        let isStartCode4 = i + 3 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;

        if (isStartCode3 || isStartCode4) {
            if (nalStart !== -1) {
                // Found the start of the *next* NAL unit, so the previous one ends here
                nalEnd = i;
                processNALUnit(data.subarray(nalStart, nalEnd));
            }
            // Mark the start of the new NAL unit (after the start code)
            nalStart = i + (isStartCode3 ? 3 : 4);
            // Optimization: Skip past the start code bytes we just processed
            // This prevents re-checking the same bytes unnecessarily, especially for 00 00 00 01
            i = nalStart - 1;
        }
    }

    // Process the last NAL unit if found
    if (nalStart !== -1 && nalStart < data.length) { // Ensure nalStart is valid
        processNALUnit(data.subarray(nalStart));
    }

    document.getElementById("downloadBtn").disabled = false;
}

function processNALUnit(nalData) {
    // H.265 NAL Unit Header is 2 bytes (16 bits)
    if (nalData.length < 2) {
        console.warn("Skipping NAL unit: Too short (less than 2 bytes). Length:", nalData.length);
        return;
    }

    // NAL Unit Header (Rec. ITU-T H.265 (08/2021), Section 7.3.1.1)
    // forbidden_zero_bit (1 bit) - nalData[0] >> 7 & 0x01 (Should be 0)
    // nal_unit_type (6 bits)     - nalData[0] >> 1 & 0x3F
    // nuh_layer_id (6 bits)      - (nalData[0] & 0x01) << 5 | (nalData[1] >> 3 & 0x1F)
    // nuh_temporal_id_plus1 (3 bits) - nalData[1] & 0x07

    let forbiddenZeroBit = (nalData[0] >> 7) & 0x01;
    if (forbiddenZeroBit !== 0) {
        console.warn("Forbidden zero bit is not zero in NAL header:", nalData[0], nalData[1]);
    }

    let nalUnitType = (nalData[0] >> 1) & 0x3F; // Extract bits 1-6 of the first byte
    let nuhLayerId = ((nalData[0] & 0x01) << 5) | (nalData[1] >> 3);
    let nuhTemporalIdPlus1 = nalData[1] & 0x07;
    let nuhTemporalId = nuhTemporalIdPlus1 - 1; // TemporalId = nuh_temporal_id_plus1 - 1

    let nalName = getNALName(nalUnitType);

    // Extract NAL header fields as well
    let headerFields = [
        { name: "forbidden_zero_bit", value: forbiddenZeroBit },
        { name: "nal_unit_type", value: nalUnitType },
        { name: "nuh_layer_id", value: nuhLayerId },
        { name: "nuh_temporal_id_plus1", value: nuhTemporalIdPlus1 },
        // { name: "nuh_temporal_id", value: nuhTemporalId } // Can add this derived value if needed
    ];

    // Pass NAL payload data *excluding* the 2-byte header to extractFields
    let payloadData = nalData.subarray(2);
    let payloadFields = extractFields(nalUnitType, payloadData);

    // Combine header and payload fields for display
    let allFields = headerFields.concat(payloadFields);

    if (allFields.length > 0) {
      displayFields(nalName, allFields, nalUnitType, nuhLayerId, nuhTemporalId); // Pass more context
    }
}


function getNALName(nalType) {
    // Based on H.265 Table 7-1: NAL unit type codes and names (Rec. ITU-T H.265 (08/2021))
    const nalMap = {
        // VCL NAL units
        0: "TRAIL_N",       // Coded slice segment of a non-TSA, non-STSA trailing picture
        1: "TRAIL_R",       // Coded slice segment of a non-TSA, non-STSA trailing picture
        2: "TSA_N",         // Coded slice segment of a TSA picture
        3: "TSA_R",         // Coded slice segment of a TSA picture
        4: "STSA_N",        // Coded slice segment of an STSA picture
        5: "STSA_R",        // Coded slice segment of an STSA picture
        6: "RADL_N",        // Coded slice segment of a RADL picture
        7: "RADL_R",        // Coded slice segment of a RADL picture
        8: "RASL_N",        // Coded slice segment of a RASL picture
        9: "RASL_R",        // Coded slice segment of a RASL picture
        10: "RSV_VCL_N10",  // Reserved VCL NAL unit types
        11: "RSV_VCL_R11",
        12: "RSV_VCL_N12",
        13: "RSV_VCL_R13",
        14: "RSV_VCL_N14",
        15: "RSV_VCL_R15",
        16: "BLA_W_LP",      // Coded slice segment of a BLA picture
        17: "BLA_W_RADL",    // Coded slice segment of a BLA picture
        18: "BLA_N_LP",      // Coded slice segment of a BLA picture
        19: "IDR_W_RADL",    // Coded slice segment of an IDR picture
        20: "IDR_N_LP",      // Coded slice segment of an IDR picture
        21: "CRA_NUT",       // Coded slice segment of a CRA picture
        22: "RSV_IRAP_VCL22", // Reserved IRAP VCL NAL unit types
        23: "RSV_IRAP_VCL23",
        // Non-VCL NAL units
        32: "VPS_NUT",       // Video parameter set
        33: "SPS_NUT",       // Sequence parameter set
        34: "PPS_NUT",       // Picture parameter set
        35: "AUD_NUT",       // Access unit delimiter
        36: "EOS_NUT",       // End of sequence
        37: "EOB_NUT",       // End of bitstream
        38: "FD_NUT",        // Filler data
        39: "PREFIX_SEI_NUT",// Supplemental enhancement information (prefix)
        40: "SUFFIX_SEI_NUT",// Supplemental enhancement information (suffix)
        41: "RSV_NVCL41",    // Reserved non-VCL NAL unit types
        42: "RSV_NVCL42",
        43: "RSV_NVCL43",
        44: "RSV_NVCL44",
        45: "RSV_NVCL45",
        46: "RSV_NVCL46",
        47: "RSV_NVCL47",
        // 48-63: Unspecified non-VCL NAL unit types (may be used by extensions/vendors)
    };
     return nalMap[nalType] || `Unspecified/Reserved (${nalType})`;
}

function extractFields(nalType, payloadData) {
    // NOTE: This remains a highly simplified parser. It reads fixed-bit-length fields (u(n))
    // at the *very beginning* of the payload. It CANNOT parse Exp-Golomb (ue(v), se(v))
    // or fields that appear after variable-length fields.
    // A proper H.265 parser requires a bitstream reader and Exp-Golomb decoding capabilities.
    let fields = [];
    if (payloadData.length === 0) return fields;

    try {
        if (nalType === 32) { // VPS_NUT (Section 7.3.2.1)
            if (payloadData.length < 4) { // Need at least 4 bytes for the fields below
                 fields.push({ name: "Payload Error", value: "Too short for basic VPS fields."});
                 return fields;
            }
            // vps_video_parameter_set_id: u(4) -> bits 0-3 of first payload byte
            fields.push({ name: "vps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F });
            // vps_base_layer_internal_flag: u(1) -> bit 4
            fields.push({ name: "vps_base_layer_internal_flag", value: (payloadData[0] >> 3) & 0x01 });
            // vps_base_layer_available_flag: u(1) -> bit 5
            fields.push({ name: "vps_base_layer_available_flag", value: (payloadData[0] >> 2) & 0x01 });
            // vps_max_layers_minus1: u(6) -> bits 6-7 of byte 0, bits 0-3 of byte 1
            let maxLayers = ((payloadData[0] & 0x03) << 4) | (payloadData[1] >> 4);
            fields.push({ name: "vps_max_layers_minus1", value: maxLayers & 0x3F });
             // vps_max_sub_layers_minus1: u(3) -> bits 4-6 of byte 1
            fields.push({ name: "vps_max_sub_layers_minus1", value: (payloadData[1] >> 1) & 0x07 });
            // vps_temporal_id_nesting_flag: u(1) -> bit 7 of byte 1
            fields.push({ name: "vps_temporal_id_nesting_flag", value: payloadData[1] & 0x01 });
            // vps_reserved_0xffff_16bits: f(16) -> bytes 2, 3 (Should be 0xFFFF)
            let reserved = (payloadData[2] << 8) | payloadData[3];
            fields.push({ name: "vps_reserved_0xffff_16bits", value: `0x${reserved.toString(16).toUpperCase()}` + (reserved === 0xFFFF ? "" : " (WARN: Not 0xFFFF)") });
            // --- Following fields require more complex parsing (profile_tier_level, loops, etc.) ---
             fields.push({ name: "...", value: "(More fields require complex parsing)" });

        } else if (nalType === 33) { // SPS_NUT (Section 7.3.2.2)
            if (payloadData.length < 1) { // Need at least 1 byte for the first few fields
                 fields.push({ name: "Payload Error", value: "Too short for basic SPS fields."});
                 return fields;
            }
            // sps_video_parameter_set_id: u(4) -> bits 0-3 of first payload byte
            fields.push({ name: "sps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F });
            // sps_max_sub_layers_minus1: u(3) -> bits 4-6 of first payload byte
            fields.push({ name: "sps_max_sub_layers_minus1", value: (payloadData[0] >> 1) & 0x07 });
            // sps_temporal_id_nesting_flag: u(1) -> bit 7 of first payload byte
            fields.push({ name: "sps_temporal_id_nesting_flag", value: payloadData[0] & 0x01 });
            // profile_tier_level structure follows (12 bytes minimum, Section 7.3.3) - Skipping detailed parsing
            // sps_seq_parameter_set_id: ue(v) -> Starts *after* profile_tier_level.
            // **Cannot reliably extract sps_seq_parameter_set_id without Exp-Golomb parsing**
             if (payloadData.length > 1) { // Check if there's potentially data for PTL
                fields.push({ name: "profile_tier_level()", value: "(Structure skipped, requires complex parsing)" });
                fields.push({ name: "sps_seq_parameter_set_id", value: "Requires Exp-Golomb (ue(v)) parsing" });
                // --- Many more fields follow, often ue(v) or conditional ---
                fields.push({ name: "...", value: "(More fields require complex parsing)" });
             } else {
                 fields.push({ name: "...", value: "(Payload too short for further fields)" });
             }

        } else if (nalType === 34) { // PPS_NUT (Section 7.3.2.3)
            // pps_pic_parameter_set_id: ue(v) -> Starts at bit 0
            // pps_seq_parameter_set_id: ue(v) -> Starts after pps_pic_parameter_set_id
            // **Cannot reliably extract these without Exp-Golomb parsing**
            fields.push({ name: "pps_pic_parameter_set_id", value: "Requires Exp-Golomb (ue(v)) parsing" });
            fields.push({ name: "pps_seq_parameter_set_id", value: "Requires Exp-Golomb (ue(v)) parsing" });
             // --- Many more fields follow ---
            fields.push({ name: "...", value: "(More fields require complex parsing)" });

        } else if (nalType === 35) { // AUD_NUT (Section 7.3.2.4)
             if (payloadData.length < 1) {
                 fields.push({ name: "Payload Error", value: "Too short for AUD field."});
                 return fields;
             }
            // pic_type: u(3) -> bits 0-2 of first payload byte
             fields.push({ name: "pic_type", value: (payloadData[0] >> 5) & 0x07 });
             // reserved bits follow
        }
        // Add more NAL types here if needed (e.g., SEI parsing is very complex)

    } catch (e) {
        console.error("Error parsing NAL unit payload (type " + nalType + "): ", e);
        // Add a field indicating parse error for this NAL unit
        fields.push({ name: "Parsing Error", value: "Could not reliably extract fields. Check console."});
    }
    return fields;
}

function displayFields(nalName, fields, nalUnitType, layerId, temporalId) {
    const container = document.getElementById("fieldsContainer");
    const nalDiv = document.createElement("div");
    nalDiv.className = "nal-unit";
    // Include more context in the header
    nalDiv.innerHTML = `<h3>${nalName} (Type ${nalUnitType}, LId ${layerId}, TId ${temporalId})</h3>`;

    fields.forEach((field, index) => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";
        // Use a unique ID including NAL type, layer, temporal ID and field name/index
        const inputId = `nal-${nalUnitType}-L${layerId}-T${temporalId}-${field.name.replace(/[^a-zA-Z0-9_]/g, '_')}-${index}`;
        const isEditable = !field.name.endsWith("...") && !field.name.includes("Error") && !field.name.includes("skipped") && !field.name.includes("Requires Exp-Golomb") && !field.name.includes("Payload too short");
        const disabledAttr = isEditable ? "" : "disabled";
        const titleAttr = isEditable ? "" : `title="Parsing/Editing not supported for this field type/value in this simple tool"`;

        fieldDiv.innerHTML = `<label for="${inputId}">${field.name}:</label> <input type="text" id="${inputId}" data-nal-type="${nalUnitType}" data-field-name="${field.name}" data-nal-index="${container.children.length}" value="${field.value}" ${disabledAttr} ${titleAttr}>`;
        nalDiv.appendChild(fieldDiv);
    });

    container.appendChild(nalDiv);
}


document.getElementById("downloadBtn").addEventListener("click", function() {
    // TODO: Implement modifyStream to actually read values from input fields
    // and update the originalData array buffer. This is non-trivial as it
    // requires careful bit manipulation and potentially recalculating NAL unit sizes
    // and handling Exp-Golomb encoding/decoding for modified values.
    // The current modifyStream just returns the original data.
    const modifiedData = modifyStream();
    if (!modifiedData) {
        console.error("Modification failed. Download cancelled.");
        alert("Modification failed. Check console for errors. Download cancelled.");
        return;
    }
    const blob = new Blob([modifiedData], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "updated.h265";
    document.body.appendChild(a); // Required for Firefox
    a.click();
    document.body.removeChild(a); // Clean up
    URL.revokeObjectURL(a.href); // Clean up
});

function modifyStream() {
    console.warn("modifyStream function is a placeholder and cannot reliably modify H.265 streams due to complexity (bitstream writing, Exp-Golomb, dependencies). Returning original data.");
    // Placeholder: In a real implementation, you would:
    // 1. Create a *copy* of originalData to modify.
    // 2. Iterate through the input fields created in displayFields *that are enabled*.
    // 3. Get the new value and validate it (e.g., ensure it's a number within the correct range for u(n) fields).
    // 4. Re-find the corresponding NAL unit in the *copied* data. This is tricky because NAL units don't have fixed indices after editing if sizes change. Need to re-parse or use offsets carefully.
    // 5. **Bitstream Writer:** Use a proper bitstream writer to modify the specific bits.
    //    - For u(n) fields: Calculate the byte and bit offset. Read the existing byte(s). Clear the relevant bits using a mask. Shift the new value to the correct bit position. OR (|) the new value into the byte(s). Write the modified byte(s) back.
    //    - For ue(v)/se(v) fields: This is much harder. You'd need to *decode* the original value, *encode* the new value using Exp-Golomb, and potentially *shift all subsequent data* within the NAL unit if the encoded size changes. This might also change the overall NAL unit size, requiring updates elsewhere if lengths are explicitly encoded (less common in basic H.265 headers but possible in SEI etc.).
    //    - Checksums/CRC: Some parameter sets might have CRCs or dependencies that need recalculation.
    // 6. Handle potential errors during modification.
    // 7. Return the *modified* Uint8Array copy, or null/throw error on failure.

    // --- Extremely Simplified Example for ONLY the first few fixed-bit VPS/SPS fields ---
    // --- THIS IS FRAGILE AND FOR ILLUSTRATION ONLY ---

    if (!originalData) return null;
    const modified = new Uint8Array(originalData); // Work on a copy
    let currentNalIndex = -1;
    let nalStartOffset = -1;
    let nalPayloadOffset = -1;
    let nalType = -1;
    let modifiedNals = new Set(); // Track which NAL display indices have been modified

    try {
        // Find all potentially edited fields
        const inputs = document.querySelectorAll('#fieldsContainer input[type="text"]:not([disabled])');
        if (inputs.length === 0) {
            console.log("No modifiable fields changed.");
            return modified; // No changes detected in editable fields
        }

        // Group inputs by their NAL display index
        const editsByNal = {};
        inputs.forEach(input => {
            const nalDisplayIndex = parseInt(input.getAttribute('data-nal-index'), 10);
            if (!editsByNal[nalDisplayIndex]) {
                editsByNal[nalDisplayIndex] = [];
            }
            // Check if value actually changed from initial display
            // Note: This relies on the initial 'value' attribute reflecting the original data accurately.
            // It might not catch cases where the user types something and then types back the original value.
            if (input.value !== input.defaultValue) {
                 editsByNal[nalDisplayIndex].push(input);
                 modifiedNals.add(nalDisplayIndex);
            }
        });

        if (modifiedNals.size === 0) {
            console.log("No values were changed from their original state.");
            return modified;
        }

        console.log(`Attempting to modify ${modifiedNals.size} NAL unit(s) based on input fields.`);

        // Iterate through NAL units in the bitstream and apply modifications if needed
        let nalCount = 0;
        let tempNalStart = -1;
        for (let i = 0; i < modified.length - 3; i++) {
            let isStartCode3 = modified[i] === 0 && modified[i + 1] === 0 && modified[i + 2] === 1;
            let isStartCode4 = i + 3 < modified.length && modified[i] === 0 && modified[i + 1] === 0 && modified[i + 2] === 0 && modified[i + 3] === 1;

            if (isStartCode3 || isStartCode4) {
                if (tempNalStart !== -1) { // Found end of previous NAL
                    if (modifiedNals.has(nalCount)) {
                        nalStartOffset = tempNalStart;
                        nalPayloadOffset = nalStartOffset + 2; // NAL Header is 2 bytes
                        nalType = (modified[nalStartOffset] >> 1) & 0x3F;
                        console.log(`Processing modifications for NAL at display index ${nalCount}, type ${nalType}, payload offset ${nalPayloadOffset}`);
                        applyModificationsToNal(modified, nalPayloadOffset, nalType, editsByNal[nalCount]);
                        modifiedNals.delete(nalCount); // Mark as processed
                    }
                    nalCount++;
                }
                tempNalStart = i + (isStartCode3 ? 3 : 4);
                i = tempNalStart - 1; // Skip start code bytes
            }
        }

         // Handle last NAL unit
        if (tempNalStart !== -1 && modifiedNals.has(nalCount)) {
             nalStartOffset = tempNalStart;
             nalPayloadOffset = nalStartOffset + 2;
             nalType = (modified[nalStartOffset] >> 1) & 0x3F;
             console.log(`Processing modifications for LAST NAL at display index ${nalCount}, type ${nalType}, payload offset ${nalPayloadOffset}`);
             applyModificationsToNal(modified, nalPayloadOffset, nalType, editsByNal[nalCount]);
             modifiedNals.delete(nalCount); // Mark as processed
        }

        if (modifiedNals.size > 0) {
            console.error(`Failed to find or process NAL units for display indices: ${[...modifiedNals].join(', ')}. Modification might be incomplete.`);
            // Depending on severity, you might want to return null or alert the user
        }

        console.log("Finished applying modifications (within supported limits).");
        return modified; // Return the modified copy

    } catch (error) {
        console.error("Error during modification process:", error);
        alert("An unexpected error occurred during modification. Check console.");
        return null;
    }
}

// Helper function to apply modifications to a specific NAL unit's payload
function applyModificationsToNal(modifiedData, payloadOffset, nalType, inputsToApply) {
    if (payloadOffset === -1 || payloadOffset >= modifiedData.length) {
        console.error(`Invalid payload offset (${payloadOffset}) for NAL type ${nalType}. Skipping modifications for this NAL.`);
        return;
    }
    if (!inputsToApply || inputsToApply.length === 0) {
        console.warn(`No input fields found for NAL at offset ${payloadOffset}, though it was marked for modification.`);
        return;
    }

    const targetNalType = parseInt(inputsToApply[0].getAttribute('data-nal-type'), 10);
    if (nalType !== targetNalType) {
        console.error(`NAL type mismatch at offset ${payloadOffset}. Expected ${targetNalType}, found ${nalType}. Aborting mods for this NAL.`);
        return; // Type mismatch, something is wrong
    }

    inputsToApply.forEach(input => {
         const fieldName = input.getAttribute('data-field-name');
         const newValueStr = input.value;
         let newValue;

         try {
             // --- VPS Fields ---
             if (nalType === 32) {
                 if (fieldName === 'vps_video_parameter_set_id') {
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 15) throw new Error("Invalid VPS ID (0-15)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0x0F) | (newValue << 4); // Update bits 0-3
                 } else if (fieldName === 'vps_base_layer_internal_flag') {
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid flag (0-1)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 3)) | (newValue << 3); // Update bit 4
                 } else if (fieldName === 'vps_base_layer_available_flag') {
                      newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid flag (0-1)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 2)) | (newValue << 2); // Update bit 5
                 } else if (fieldName === 'vps_max_layers_minus1') {
                     // u(6) spans 2 bytes
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 63) throw new Error("Invalid max_layers_minus1 (0-63)");
                     // Bits 6-7 of byte 0, bits 0-3 of byte 1
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFC) | ((newValue >> 4) & 0x03); // Update bits 6-7 of byte 0
                     if (payloadOffset + 1 < modifiedData.length) {
                        modifiedData[payloadOffset+1] = (modifiedData[payloadOffset+1] & 0x0F) | ((newValue & 0x0F) << 4); // Update bits 0-3 of byte 1
                     } else { throw new Error("NAL too short to write byte 1 for vps_max_layers_minus1"); }
                 } else if (fieldName === 'vps_max_sub_layers_minus1') {
                      // u(3) in byte 1
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error("Invalid max_sub_layers_minus1 (0-7)");
                     if (payloadOffset + 1 < modifiedData.length) {
                         // Update bits 4-6 of byte 1
                         modifiedData[payloadOffset+1] = (modifiedData[payloadOffset+1] & ~(0x07 << 1)) | (newValue << 1);
                     } else { throw new Error("NAL too short to write byte 1 for vps_max_sub_layers_minus1"); }
                 } else if (fieldName === 'vps_temporal_id_nesting_flag') {
                      // u(1) in byte 1
                      newValue = parseInt(newValueStr, 10);
                      if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid flag (0-1)");
                      if (payloadOffset + 1 < modifiedData.length) {
                           modifiedData[payloadOffset+1] = (modifiedData[payloadOffset+1] & ~0x01) | (newValue & 0x01); // Update bit 7 of byte 1
                     } else { throw new Error("NAL too short to write byte 1 for vps_temporal_id_nesting_flag"); }
                 }
                 // Add other simple VPS fields here if parsed
             }
             // --- SPS Fields ---
             else if (nalType === 33) {
                 if (fieldName === 'sps_video_parameter_set_id') {
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 15) throw new Error("Invalid SPS VPS ID (0-15)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0x0F) | (newValue << 4); // Update bits 0-3
                 } else if (fieldName === 'sps_max_sub_layers_minus1') {
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error("Invalid SPS max_sub_layers_minus1 (0-7)");
                     // Update bits 4-6 of byte 0
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(0x07 << 1)) | (newValue << 1);
                 } else if (fieldName === 'sps_temporal_id_nesting_flag') { // <<<< ADDED FIELD
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid SPS temporal nesting flag (0-1)");
                      // Update bit 7 of byte 0
                      modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~0x01) | (newValue & 0x01);
                 }
                 // Add other simple SPS fields here if parsed
             }
             // --- AUD Fields ---
             else if (nalType === 35) {
                  if (fieldName === 'pic_type') {
                      newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error("Invalid pic_type (0-7)");
                     // Update bits 0-2 of byte 0
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(0x07 << 5)) | (newValue << 5);
                 }
             }
             // --- Add other NAL types if needed ---
             else {
                 console.warn(`Modification for field '${fieldName}' in NAL type ${nalType} not implemented.`);
             }

         } catch (err) {
             // Throw the error up to the main modifyStream catch block after logging
             console.error(`Error processing field '${fieldName}' with value '${newValueStr}' for NAL at offset ${payloadOffset}: ${err.message}`);
             throw err; // Re-throw to abort modification process
         }
    });
}
