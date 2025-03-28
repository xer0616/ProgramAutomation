
const version = 7
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
    let nalCount = 0; // Add a counter for unique IDs

    for (let i = 0; i < data.length - 3; i++) {
        // Find NAL unit start code (00 00 01 or 00 00 00 01)
        let isStartCode3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
        let isStartCode4 = i + 3 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;

        if (isStartCode3 || isStartCode4) {
            if (nalStart !== -1) {
                // Found the start of the *next* NAL unit, so the previous one ends here
                nalEnd = i;
                processNALUnit(data.subarray(nalStart, nalEnd), nalCount++);
            }
            // Mark the start of the new NAL unit (after the start code)
            nalStart = i + (isStartCode3 ? 3 : 4);
            // Optimization: Skip past the start code bytes we just processed
            i = nalStart - 1;
        }
    }

    // Process the last NAL unit if found
    if (nalStart !== -1 && nalStart < data.length) { // Ensure nalStart is valid
        processNALUnit(data.subarray(nalStart), nalCount++);
    }

    document.getElementById("downloadBtn").disabled = false;
}

function processNALUnit(nalData, nalIndex) {
    // H.265 NAL Unit Header is 2 bytes (16 bits)
    if (nalData.length < 2) {
        console.warn(`Skipping NAL unit #${nalIndex}: Too short (less than 2 bytes). Length:`, nalData.length);
        return;
    }

    // NAL Unit Header (Rec. ITU-T H.265 (08/2021), Section 7.3.1.1)
    // forbidden_zero_bit (1 bit) - nalData[0] >> 7 & 0x01 (Should be 0)
    // nal_unit_type (6 bits)     - nalData[0] >> 1 & 0x3F
    // nuh_layer_id (6 bits)      - (nalData[0] & 0x01) << 5 | (nalData[1] >> 3 & 0x1F)
    // nuh_temporal_id_plus1 (3 bits) - nalData[1] & 0x07

    let forbiddenZeroBit = (nalData[0] >> 7) & 0x01;
    if (forbiddenZeroBit !== 0) {
        console.warn(`NAL #${nalIndex}: Forbidden zero bit is not zero in NAL header:`, nalData[0], nalData[1]);
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
      displayFields(nalName, allFields, nalUnitType, nuhLayerId, nuhTemporalId, nalIndex); // Pass nalIndex
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
    // or fields that appear after variable-length fields (like profile_tier_level).
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

            // --- Structure profile_tier_level() follows (Section 7.3.3) ---
            // This structure is variable length (min 12 bytes) and complex.
            // We cannot reliably parse *past* it without a full bitstream reader.
            fields.push({ name: "profile_tier_level()", value: "(Structure skipped, complex & variable length)" });

            // --- sps_seq_parameter_set_id: ue(v) ---
            // This field comes *after* profile_tier_level().
            // Cannot parse without decoding profile_tier_level() and ue(v).
            fields.push({ name: "sps_seq_parameter_set_id", value: "Requires ue(v) parsing AFTER profile_tier_level()" });

            // --- Many more fields follow, often ue(v) or conditional ---
            fields.push({ name: "...", value: "(More fields require complex parsing)" });

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

function displayFields(nalName, fields, nalUnitType, layerId, temporalId, nalIndex) { // Added nalIndex
    const container = document.getElementById("fieldsContainer");
    const nalDiv = document.createElement("div");
    nalDiv.className = "nal-unit";
    // Include more context in the header, including the NAL index
    nalDiv.innerHTML = `<h3>#${nalIndex}: ${nalName} (Type ${nalUnitType}, LId ${layerId}, TId ${temporalId})</h3>`;

    fields.forEach((field, fieldIndex) => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";
        // Use a unique ID including NAL index and field name/index
        const inputId = `nal-${nalIndex}-field-${field.name.replace(/[^a-zA-Z0-9_]/g, '_')}-${fieldIndex}`;
        const isEditable = !field.name.endsWith("...") &&
                           !field.name.includes("Error") &&
                           !field.name.includes("skipped") &&
                           !field.name.includes("Requires ") && // Catches "Requires Exp-Golomb", "Requires ue(v)..." etc.
                           !field.name.includes("Payload too short");
        const disabledAttr = isEditable ? "" : "disabled";
        const titleAttr = isEditable ? "" : `title="Parsing/Editing not supported for this field type/value in this simple tool"`;

        fieldDiv.innerHTML = `<label for="${inputId}">${field.name}:</label> <input type="text" id="${inputId}" data-nal-index="${nalIndex}" data-field-name="${field.name}" value="${field.value}" ${disabledAttr} ${titleAttr}>`;
        // Store original value for comparison on modify
        fieldDiv.querySelector('input').defaultValue = field.value;
        nalDiv.appendChild(fieldDiv);
    });

    container.appendChild(nalDiv);
}


document.getElementById("downloadBtn").addEventListener("click", function() {
    // Modify the stream based on user input
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
    console.warn("modifyStream function is limited and cannot reliably modify H.265 streams with variable-length fields (like Exp-Golomb), complex structures, or fields beyond the first few bytes. Only simple u(n) fields at the start of VPS/SPS/AUD payloads are supported for modification.");

    if (!originalData) return null;
    const modified = new Uint8Array(originalData); // Work on a copy
    let currentNalIndex = -1;
    let nalStartOffset = -1;
    let nalPayloadOffset = -1;
    let nalType = -1;
    let modifiedNalsIndices = new Set(); // Track which NAL display indices have been modified

    try {
        // Find all potentially edited fields that are enabled and changed
        const inputs = document.querySelectorAll('#fieldsContainer input[type="text"]:not([disabled])');
        if (inputs.length === 0) {
            console.log("No modifiable fields found.");
            return modified; // Return original if no editable fields exist
        }

        // Group inputs by their NAL display index and check if value actually changed
        const editsByNal = {};
        inputs.forEach(input => {
            // Only process if the value changed from the initially displayed value
            if (input.value !== input.defaultValue) {
                 const nalDisplayIndex = parseInt(input.getAttribute('data-nal-index'), 10);
                 if (isNaN(nalDisplayIndex)) {
                     console.warn("Skipping input with invalid NAL index:", input.id);
                     return;
                 }
                 if (!editsByNal[nalDisplayIndex]) {
                     editsByNal[nalDisplayIndex] = [];
                 }
                 editsByNal[nalDisplayIndex].push(input);
                 modifiedNalsIndices.add(nalDisplayIndex);
            }
        });

        if (modifiedNalsIndices.size === 0) {
            console.log("No values were changed from their original state.");
            return modified; // Return original if no values were changed
        }

        console.log(`Attempting to modify ${modifiedNalsIndices.size} NAL unit(s) based on input fields: Indices ${[...modifiedNalsIndices].join(', ')}`);

        // Re-iterate through NAL units in the bitstream to find the correct offsets
        let nalCount = 0;
        let tempNalStart = -1;
        for (let i = 0; i < modified.length - 3; i++) {
            let isStartCode3 = modified[i] === 0 && modified[i + 1] === 0 && modified[i + 2] === 1;
            let isStartCode4 = i + 3 < modified.length && modified[i] === 0 && modified[i + 1] === 0 && modified[i + 2] === 0 && modified[i + 3] === 1;

            if (isStartCode3 || isStartCode4) {
                if (tempNalStart !== -1) { // Found end of previous NAL
                    if (modifiedNalsIndices.has(nalCount)) {
                        nalStartOffset = tempNalStart;
                        // Check header length before accessing
                        if (nalStartOffset + 1 < modified.length) {
                            nalPayloadOffset = nalStartOffset + 2; // NAL Header is 2 bytes
                            nalType = (modified[nalStartOffset] >> 1) & 0x3F;
                            console.log(`Applying modifications for NAL #${nalCount}, Type ${nalType}, Payload Offset ${nalPayloadOffset}`);
                            applyModificationsToNal(modified, nalPayloadOffset, nalType, editsByNal[nalCount]);
                            modifiedNalsIndices.delete(nalCount); // Mark as processed
                        } else {
                             console.error(`NAL #${nalCount} at offset ${tempNalStart} is too short for header. Cannot modify.`);
                             modifiedNalsIndices.delete(nalCount); // Cannot process, remove from set
                        }
                    }
                    nalCount++;
                }
                tempNalStart = i + (isStartCode3 ? 3 : 4);
                i = tempNalStart - 1; // Skip start code bytes
            }
        }

         // Handle last NAL unit
        if (tempNalStart !== -1) { // Check if at least one NAL was found
             if (modifiedNalsIndices.has(nalCount)) {
                 nalStartOffset = tempNalStart;
                 if (nalStartOffset + 1 < modified.length) {
                     nalPayloadOffset = nalStartOffset + 2;
                     nalType = (modified[nalStartOffset] >> 1) & 0x3F;
                     console.log(`Applying modifications for LAST NAL #${nalCount}, Type ${nalType}, Payload Offset ${nalPayloadOffset}`);
                     applyModificationsToNal(modified, nalPayloadOffset, nalType, editsByNal[nalCount]);
                     modifiedNalsIndices.delete(nalCount); // Mark as processed
                 } else {
                      console.error(`LAST NAL #${nalCount} at offset ${tempNalStart} is too short for header. Cannot modify.`);
                      modifiedNalsIndices.delete(nalCount); // Cannot process, remove from set
                 }
            }
        }


        if (modifiedNalsIndices.size > 0) {
            console.error(`Failed to find or process NAL units for indices: ${[...modifiedNalsIndices].join(', ')}. Modification might be incomplete or failed.`);
            // Consider returning null or alerting the user more strongly
             alert(`Modification failed for some NAL units (Indices: ${[...modifiedNalsIndices].join(', ')}). See console.`)
             return null; // Indicate failure
        }

        console.log("Finished applying modifications (within supported limits).");
        return modified; // Return the modified copy

    } catch (error) {
        console.error("Error during modification process:", error);
        alert(`An unexpected error occurred during modification: ${error.message}. Check console.`);
        return null; // Indicate failure
    }
}

// Helper function to apply modifications to a specific NAL unit's payload
// WARNING: Only handles specific fixed-bit fields at the beginning of the payload.
function applyModificationsToNal(modifiedData, payloadOffset, nalType, inputsToApply) {
    // Basic validation
    if (payloadOffset === -1 || payloadOffset >= modifiedData.length) {
        console.error(`Invalid payload offset (${payloadOffset}) for NAL type ${nalType}. Skipping modifications.`);
        // Re-throw an error to be caught by modifyStream to signal failure for this NAL
        throw new Error(`Invalid payload offset ${payloadOffset} for NAL type ${nalType}`);
    }
    if (!inputsToApply || inputsToApply.length === 0) {
        // This shouldn't happen if modifyStream groups correctly, but check anyway.
        console.warn(`No input fields provided for NAL at offset ${payloadOffset}, skipping.`);
        return;
    }

    // No need to check nalType match here, as modifyStream already found the NAL by index.
    // We rely on the data attributes being correct from displayFields.

    inputsToApply.forEach(input => {
         const fieldName = input.getAttribute('data-field-name');
         const newValueStr = input.value;
         let newValue;

         // Function to check payload bounds before writing
         const checkBounds = (offset, bytesNeeded = 1) => {
             if (offset + bytesNeeded > modifiedData.length) {
                 throw new Error(`NAL payload too short to write '${fieldName}' at offset ${offset}. Needs ${bytesNeeded} byte(s).`);
             }
         };

         try {
             // --- NAL Header Fields --- (Example, if they were made editable)
             // if (fieldName === 'nuh_layer_id') { ... }
             // if (fieldName === 'nuh_temporal_id_plus1') { ... }

             // --- VPS Fields (Type 32) ---
             if (nalType === 32) {
                 checkBounds(payloadOffset); // Need at least byte 0
                 if (fieldName === 'vps_video_parameter_set_id') { // u(4) in byte 0
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 15) throw new Error("Invalid VPS ID (0-15)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0x0F) | (newValue << 4);
                 } else if (fieldName === 'vps_base_layer_internal_flag') { // u(1) in byte 0
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid flag (0-1)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 3)) | (newValue << 3);
                 } else if (fieldName === 'vps_base_layer_available_flag') { // u(1) in byte 0
                      newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid flag (0-1)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 2)) | (newValue << 2);
                 } else if (fieldName === 'vps_max_layers_minus1') { // u(6) spanning byte 0/1
                     checkBounds(payloadOffset + 1); // Need byte 0 and 1
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 63) throw new Error("Invalid max_layers_minus1 (0-63)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFC) | ((newValue >> 4) & 0x03); // Bits 6-7 of byte 0
                     modifiedData[payloadOffset+1] = (modifiedData[payloadOffset+1] & 0x0F) | ((newValue & 0x0F) << 4); // Bits 0-3 of byte 1
                 } else if (fieldName === 'vps_max_sub_layers_minus1') { // u(3) in byte 1
                     checkBounds(payloadOffset + 1); // Need byte 1
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error("Invalid max_sub_layers_minus1 (0-7)");
                     modifiedData[payloadOffset+1] = (modifiedData[payloadOffset+1] & ~(0x07 << 1)) | (newValue << 1); // Bits 4-6 of byte 1
                 } else if (fieldName === 'vps_temporal_id_nesting_flag') { // u(1) in byte 1
                      checkBounds(payloadOffset + 1); // Need byte 1
                      newValue = parseInt(newValueStr, 10);
                      if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid flag (0-1)");
                      modifiedData[payloadOffset+1] = (modifiedData[payloadOffset+1] & ~0x01) | (newValue & 0x01); // Bit 7 of byte 1
                 }
                 // Note: vps_reserved_0xffff_16bits is usually not modified, skipping.
             }
             // --- SPS Fields (Type 33) ---
             else if (nalType === 33) {
                 checkBounds(payloadOffset); // Need at least byte 0
                 if (fieldName === 'sps_video_parameter_set_id') { // u(4) in byte 0
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 15) throw new Error("Invalid SPS VPS ID (0-15)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0x0F) | (newValue << 4);
                 } else if (fieldName === 'sps_max_sub_layers_minus1') { // u(3) in byte 0
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error("Invalid SPS max_sub_layers_minus1 (0-7)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(0x07 << 1)) | (newValue << 1); // Bits 4-6
                 } else if (fieldName === 'sps_temporal_id_nesting_flag') { // u(1) in byte 0
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error("Invalid SPS temporal nesting flag (0-1)");
                      modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~0x01) | (newValue & 0x01); // Bit 7
                 }
                 // IMPORTANT: Cannot modify sps_seq_parameter_set_id or anything after profile_tier_level() here.
             }
             // --- AUD Fields (Type 35) ---
             else if (nalType === 35) {
                  checkBounds(payloadOffset); // Need at least byte 0
                  if (fieldName === 'pic_type') { // u(3) in byte 0
                      newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error("Invalid pic_type (0-7)");
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(0x07 << 5)) | (newValue << 5); // Bits 0-2
                 }
             }
             // --- Add other simple NAL types if needed ---
             else {
                 // This case should ideally not be reached if input is disabled correctly.
                 console.warn(`Modification for field '${fieldName}' in NAL type ${nalType} is not implemented or field is not editable.`);
             }

         } catch (err) {
             // Log the specific error and re-throw to notify modifyStream
             console.error(`Error modifying field '${fieldName}' (value: '${newValueStr}') in NAL type ${nalType} at payload offset ${payloadOffset}: ${err.message}`);
             throw err; // Propagate error up
         }
    });
}
