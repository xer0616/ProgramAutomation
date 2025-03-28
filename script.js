
const version = 4
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
            i = nalStart - 1; // Continue search from the byte after the start code
        }
    }

    // Process the last NAL unit if found
    if (nalStart !== -1) {
        processNALUnit(data.subarray(nalStart));
    }

    document.getElementById("downloadBtn").disabled = false;
}

function processNALUnit(nalData) {
    if (nalData.length < 2) return; // Need at least NAL header (2 bytes)

    // NAL Unit Header (first 2 bytes)
    // forbidden_zero_bit (1 bit)
    // nal_unit_type (6 bits)
    // nuh_layer_id (6 bits)
    // nuh_temporal_id_plus1 (3 bits)
    let nalUnitType = (nalData[0] & 0x7E) >> 1;
    let nalName = getNALName(nalUnitType);

    // Pass NAL data *excluding* the 2-byte header to extractFields
    let fields = extractFields(nalUnitType, nalData.subarray(2));
    if (fields.length > 0) {
      displayFields(nalName, fields, nalUnitType); // Pass nalUnitType for context
    }
}


function getNALName(nalType) {
    // Based on H.265 Table 7-1: NAL unit type codes
    const nalMap = {
        // VCL NAL units
        0: "TRAIL_N", 1: "TRAIL_R", 2: "TSA_N", 3: "TSA_R", 4: "STSA_N", 5: "STSA_R",
        6: "RADL_N", 7: "RADL_R", 8: "RASL_N", 9: "RASL_R",
        16: "BLA_W_LP", 17: "BLA_W_RADL", 18: "BLA_N_LP", 19: "IDR_W_RADL", 20: "IDR_N_LP",
        21: "CRA_NUT", 22: "RSV_IRAP_VCL22", 23: "RSV_IRAP_VCL23",
        // Non-VCL NAL units
        32: "VPS_NUT", // Video Parameter Set
        33: "SPS_NUT", // Sequence Parameter Set
        34: "PPS_NUT", // Picture Parameter Set
        35: "AUD_NUT", // Access Unit Delimiter
        36: "EOS_NUT", // End Of Sequence
        37: "EOB_NUT", // End Of Bitstream
        38: "FD_NUT",  // Filler Data
        39: "PREFIX_SEI_NUT", // Supplemental Enhancement Information (Prefix)
        40: "SUFFIX_SEI_NUT", // Supplemental Enhancement Information (Suffix)
        // 41-47: Reserved
        // 48-63: Unspecified
    };
    return nalMap[nalType] || `NAL Type ${nalType}`;
}

function extractFields(nalType, payloadData) {
    // NOTE: This is a highly simplified parser assuming fixed positions,
    // which is NOT generally true for H.265 due to Exp-Golomb coding.
    // This only attempts to extract the specific fields requested based
    // on their typical *starting* byte/bit positions in simple cases.
    // A proper parser needs a bitstream reader and Exp-Golomb decoder.
    let fields = [];
    if (payloadData.length === 0) return fields;

    try {
        if (nalType === 32) { // VPS_NUT
            // vps_video_parameter_set_id: u(4) -> bits 0-3 of first payload byte
            fields.push({ name: "vps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F });
            // vps_base_layer_internal_flag: u(1) -> bit 4
            // vps_base_layer_available_flag: u(1) -> bit 5
            // vps_max_layers_minus1: u(6) -> bits 6-7 of byte 0, bits 0-3 of byte 1
            let maxLayers = ((payloadData[0] & 0x03) << 4) | (payloadData[1] >> 4);
            fields.push({ name: "vps_max_layers_minus1", value: maxLayers & 0x3F });
             // vps_max_sub_layers_minus1: u(3) -> bits 4-6 of byte 1
            fields.push({ name: "vps_max_sub_layers_minus1", value: (payloadData[1] >> 1) & 0x07 });
            // vps_temporal_id_nesting_flag: u(1) -> bit 7 of byte 1
             // vps_reserved_0xffff_16bits: u(16) -> bytes 2, 3 (Skipping for this simple parser)
        } else if (nalType === 33) { // SPS_NUT
            // sps_video_parameter_set_id: u(4) -> bits 0-3 of first payload byte
            fields.push({ name: "sps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F });
            // sps_max_sub_layers_minus1: u(3) -> bits 4-6 of first payload byte
            fields.push({ name: "sps_max_sub_layers_minus1", value: (payloadData[0] >> 1) & 0x07 });
            // sps_temporal_id_nesting_flag: u(1) -> bit 7 of first payload byte
            // profile_tier_level structure follows (Complex - Skipping)
            // sps_seq_parameter_set_id: ue(v) -> Starts after profile_tier_level.
            // **Cannot reliably extract sps_seq_parameter_set_id without Exp-Golomb parsing**
            // The original script's attempt was likely incorrect. We'll omit it here
            // for correctness within the limitations of this simplified parser.
            // fields.push({ name: "sps_seq_parameter_set_id", value: "Requires Exp-Golomb" });
        } else if (nalType === 34) { // PPS_NUT
            // pps_pic_parameter_set_id: ue(v) -> Starts at bit 0
            // pps_seq_parameter_set_id: ue(v) -> Starts after pps_pic_parameter_set_id
            // **Cannot reliably extract these without Exp-Golomb parsing**
            // The original script's attempt was likely incorrect. We'll omit them here
            // for correctness within the limitations of this simplified parser.
            // fields.push({ name: "pps_pic_parameter_set_id", value: "Requires Exp-Golomb" });
            // fields.push({ name: "pps_seq_parameter_set_id", value: "Requires Exp-Golomb" });
        }
    } catch (e) {
        console.error("Error parsing NAL unit payload (type " + nalType + "): ", e);
        // Add a field indicating parse error for this NAL unit
        fields.push({ name: "Parsing Error", value: "Could not reliably extract fields."});
    }
    return fields;
}

function displayFields(nalName, fields, nalUnitType) {
    const container = document.getElementById("fieldsContainer");
    const nalDiv = document.createElement("div");
    nalDiv.className = "nal-unit";
    nalDiv.innerHTML = `<h3>${nalName} (Type ${nalUnitType})</h3>`;

    fields.forEach((field, index) => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";
        // Use a unique ID including NAL type and field name/index to avoid duplicates
        const inputId = `nal-${nalUnitType}-${field.name.replace(/\s+/g, '_')}-${index}`;
        fieldDiv.innerHTML = `<label for="${inputId}">${field.name}:</label> <input type="text" id="${inputId}" data-nal-type="${nalUnitType}" data-field-name="${field.name}" value="${field.value}">`;
        nalDiv.appendChild(fieldDiv);
    });

    container.appendChild(nalDiv);
}


document.getElementById("downloadBtn").addEventListener("click", function() {
    // TODO: Implement modifyStream to actually read values from input fields
    // and update the originalData array buffer. This is non-trivial as it
    // requires careful bit manipulation and potentially recalculating NAL unit sizes
    // and handling Exp-Golomb encoding for modified values.
    // The current modifyStream just returns the original data.
    const modifiedData = modifyStream();
    const blob = new Blob([modifiedData], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "updated.h265";
    a.click();
    URL.revokeObjectURL(a.href); // Clean up
});

function modifyStream() {
    console.warn("modifyStream function is not fully implemented. Returning original data.");
    // Placeholder: In a real implementation, you would:
    // 1. Iterate through the input fields created in displayFields.
    // 2. For each field, get its new value.
    // 3. Find the corresponding NAL unit in originalData.
    // 4. Parse the NAL unit (ideally with a proper bitstream reader/writer).
    // 5. Update the specific bits corresponding to the field with the new value.
    // 6. Handle potential changes in NAL unit size (especially with ue(v) fields).
    // 7. Reconstruct the entire bitstream.
    // This is complex and beyond the scope of the simple extraction update.
    return originalData || new Uint8Array([]);
}
