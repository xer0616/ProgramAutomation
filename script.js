
const version = 16
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
    fieldsContainer.innerHTML = ""; // Clear previous results
    let nalStart = -1;
    let nalEnd = -1;
    let nalCount = 0; // Counter for unique IDs

    // Annex B byte stream format: NAL units are preceded by start codes
    // 0x000001 or 0x00000001
    for (let i = 0; i < data.length - 2; i++) { // Ensure we can read at least 3 bytes
        let isStartCode3 = false;
        let isStartCode4 = false;
        let startCodeLen = 0;

        // Check for 4-byte start code first (00 00 00 01)
        if (i + 3 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
            isStartCode4 = true;
            startCodeLen = 4;
        }
        // Check for 3-byte start code (00 00 01) only if 4-byte wasn't found
        else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
            isStartCode3 = true;
            startCodeLen = 3;
        }

        if (isStartCode3 || isStartCode4) {
            if (nalStart !== -1) {
                // Found the start of the *next* NAL unit, so the previous one ends *before* this start code
                nalEnd = i;
                // Extract the NAL unit data (from after the previous start code up to here)
                processNALUnit(data.subarray(nalStart, nalEnd), nalCount++);
            }
            // Mark the start of the *new* NAL unit (position *after* the start code)
            nalStart = i + startCodeLen;
            // Optimization: Skip past the start code bytes we just processed
            i = nalStart - 1; // The loop increment (i++) will move to the first byte of the NAL unit
        }
    }

    // Process the last NAL unit in the buffer if one was started
    if (nalStart !== -1 && nalStart < data.length) {
        // The last NAL unit goes from its start position to the end of the data
        processNALUnit(data.subarray(nalStart), nalCount++);
    }

    document.getElementById("downloadBtn").disabled = (nalCount === 0); // Disable if no NAL units found
}

function processNALUnit(nalData, nalIndex) {
    // H.265 NAL Unit Header is 2 bytes (16 bits)
    if (nalData.length < 2) {
        console.warn(`Skipping NAL unit #${nalIndex}: Too short (less than 2 bytes). Length:`, nalData.length);
        return;
    }

    // NAL Unit Header (Rec. ITU-T H.265 (08/2021), Section 7.3.1.1)
    // +---------------+---------------+-----------------+-----------------+
    // |0|1|2|3|4|5|6|7|0|1|2|3|4|5|6|7|
    // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    // |F|   Type    | LayerId | TID |
    // +---------------+---------------+-----------------+-----------------+
    // forbidden_zero_bit (1 bit)       [F]       - nalData[0] >> 7
    // nal_unit_type (6 bits)           [Type]    - nalData[0] >> 1 & 0x3F
    // nuh_layer_id (6 bits)            [LayerId] - (nalData[0] & 0x01) << 5 | (nalData[1] >> 3)
    // nuh_temporal_id_plus1 (3 bits)   [TID]     - nalData[1] & 0x07

    let forbiddenZeroBit = (nalData[0] >> 7) & 0x01;
    if (forbiddenZeroBit !== 0) {
        // The standard requires this bit to be 0. Decoders may discard NAL units where it's 1.
        console.warn(`NAL #${nalIndex}: Forbidden zero bit is not zero in NAL header: byte 0 = 0x${nalData[0].toString(16)}`);
    }

    let nalUnitType = (nalData[0] >> 1) & 0x3F; // Extract bits 1 through 6 of the first byte
    let nuhLayerId = ((nalData[0] & 0x01) << 5) | (nalData[1] >> 3); // Extract bit 7 of byte 0 and bits 0-4 of byte 1
    let nuhTemporalIdPlus1 = nalData[1] & 0x07; // Extract bits 5-7 of the second byte
    let nuhTemporalId = nuhTemporalIdPlus1 - 1; // TemporalId = nuh_temporal_id_plus1 - 1 (Value 0 is invalid for nuh_temporal_id_plus1)

    if (nuhTemporalIdPlus1 === 0) {
        console.warn(`NAL #${nalIndex}: Invalid nuh_temporal_id_plus1 value (0).`);
        // Handle this case as appropriate, maybe treat TemporalId as -1 or invalid
        nuhTemporalId = -1; // Indicate invalid
    }

    let nalName = getNALName(nalUnitType);

    // Extract NAL header fields
    let headerFields = [
        { name: "forbidden_zero_bit", value: forbiddenZeroBit },
        { name: "nal_unit_type", value: nalUnitType },
        { name: "nuh_layer_id", value: nuhLayerId },
        { name: "nuh_temporal_id_plus1", value: nuhTemporalIdPlus1 },
        // { name: "nuh_temporal_id", value: nuhTemporalId } // Display derived TemporalId if useful
    ];

    // Pass NAL payload data *excluding* the 2-byte header to extractFields
    // This data is the Raw Byte Sequence Payload (RBSP) before start code emulation prevention bytes are removed.
    // Proper parsing often requires removing these emulation prevention bytes (0x03 in 0x000003 sequences).
    // This simplified script does NOT remove emulation prevention bytes.
    let payloadData = nalData.subarray(2);
    let payloadFields = extractFields(nalUnitType, payloadData);

    // Combine header and payload fields for display
    let allFields = headerFields.concat(payloadFields);

    // Display even if payloadFields is empty, to show header info
    displayFields(nalName, allFields, nalUnitType, nuhLayerId, nuhTemporalId, nalIndex);
}


function getNALName(nalType) {
    // Based on H.265 Table 7-1: NAL unit type codes and names (Rec. ITU-T H.265 (08/2021))
    const nalMap = {
        // VCL NAL units (Video Coding Layer)
        0: "TRAIL_N",       // Coded slice segment of a non-TSA, non-STSA trailing picture (non-reference)
        1: "TRAIL_R",       // Coded slice segment of a non-TSA, non-STSA trailing picture (reference)
        2: "TSA_N",         // Coded slice segment of a TSA picture (Temporal Sub-layer Access) (non-reference)
        3: "TSA_R",         // Coded slice segment of a TSA picture (reference)
        4: "STSA_N",        // Coded slice segment of an STSA picture (Step-wise Temporal Sub-layer Access) (non-reference)
        5: "STSA_R",        // Coded slice segment of an STSA picture (reference)
        6: "RADL_N",        // Coded slice segment of a RADL picture (Random Access Decodable Leading) (non-reference)
        7: "RADL_R",        // Coded slice segment of a RADL picture (reference)
        8: "RASL_N",        // Coded slice segment of a RASL picture (Random Access Skipped Leading) (non-reference)
        9: "RASL_R",        // Coded slice segment of a RASL picture (reference)
        10: "RSV_VCL_N10",  // Reserved VCL non-reference NAL unit types
        11: "RSV_VCL_R11",  // Reserved VCL reference NAL unit types
        12: "RSV_VCL_N12",
        13: "RSV_VCL_R13",
        14: "RSV_VCL_N14",
        15: "RSV_VCL_R15",
        16: "BLA_W_LP",      // Coded slice segment of a BLA picture (Broken Link Access) with leading pictures
        17: "BLA_W_RADL",    // Coded slice segment of a BLA picture with RADL
        18: "BLA_N_LP",      // Coded slice segment of a BLA picture without leading pictures
        19: "IDR_W_RADL",    // Coded slice segment of an IDR picture (Instantaneous Decoding Refresh) with RADL
        20: "IDR_N_LP",      // Coded slice segment of an IDR picture without leading pictures
        21: "CRA_NUT",       // Coded slice segment of a CRA picture (Clean Random Access)
        22: "RSV_IRAP_VCL22", // Reserved IRAP (Intra Random Access Point) VCL NAL unit types
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
        // 48-63: Unspecified non-VCL NAL unit types (may be used by extensions/vendors or future spec versions)
    };
    if (nalType >= 24 && nalType <= 31) return `RSV_NVCL${nalType}`; // Reserved non-VCL range
    if (nalType >= 48 && nalType <= 63) return `UNSPEC${nalType}`;   // Unspecified range
    return nalMap[nalType] || `UNKNOWN (${nalType})`; // Fallback for unexpected values
}

function extractFields(nalType, payloadData) {
    // WARNING: This parser is extremely basic. It only attempts to read a few
    // fixed-bit-length fields (u(n), f(n)) at the very START of specific NAL unit payloads.
    // It CANNOT parse:
    //   - Exp-Golomb codes (ue(v), se(v)) which are common in H.265 (e.g., pic_width/height, conf_win_*_offset).
    //   - Fields located after variable-length fields (like profile_tier_level, or anything after ue(v)/se(v)).
    //   - Conditional fields based on previously parsed values (like conf_win_left_offset depending on conformance_window_flag).
    //   - Fields requiring removal of emulation prevention bytes (0x000003 -> 0x0000).
    // A proper H.265 parser requires a bitstream reader capable of handling these complexities.
    let fields = [];
    if (payloadData.length === 0) return fields; // No payload to parse

    try {
        if (nalType === 32) { // VPS_NUT (Video Parameter Set, Section 7.3.2.1)
            if (payloadData.length < 4) { // Need at least 4 bytes for the first few fields we attempt to parse
                 fields.push({ name: "Payload Error", value: "Too short for initial VPS fields."});
                 return fields;
            }
            // vps_video_parameter_set_id: u(4) -> bits 0-3 of first payload byte
            fields.push({ name: "vps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F });
            // vps_base_layer_internal_flag: u(1) -> bit 4 of first payload byte
            fields.push({ name: "vps_base_layer_internal_flag", value: (payloadData[0] >> 3) & 0x01 });
            // vps_base_layer_available_flag: u(1) -> bit 5 of first payload byte
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

            // --- Following fields require more complex parsing ---
            // profile_tier_level() structure (variable length, min 12 bytes)
            // vps_sub_layer_ordering_info_present_flag u(1)
            // loops for sub-layer ordering info (if present)
            // vps_max_dec_pic_buffering_minus1[i] ue(v)
            // vps_max_num_reorder_pics[i] ue(v)
            // vps_max_latency_increase_plus1[i] ue(v)
            // vps_max_layer_id u(6)
            // vps_num_layer_sets_minus1 ue(v)
            // loops for layer_id_included_flag[ i ][ j ] u(1)
            // vps_timing_info_present_flag u(1)
            // ...and so on.
            fields.push({ name: "...", value: "(More fields require complex parsing: profile_tier_level, ue(v), loops, etc.)" });

        } else if (nalType === 33) { // SPS_NUT (Sequence Parameter Set, Section 7.3.2.2)
            if (payloadData.length < 1) { // Need at least 1 byte for the first few fields
                 fields.push({ name: "Payload Error", value: "Too short for initial SPS fields."});
                 return fields;
            }
            // NOTE: These initial fields are only at these fixed positions if profile_tier_level() hasn't started.
            // The actual parsing requires a bitstream reader. This is just a heuristic guess.
            // sps_video_parameter_set_id: u(4) -> bits 0-3 of first payload byte
            fields.push({ name: "sps_video_parameter_set_id", value: (payloadData[0] >> 4) & 0x0F });
            // sps_max_sub_layers_minus1: u(3) -> bits 4-6 of first payload byte
            fields.push({ name: "sps_max_sub_layers_minus1", value: (payloadData[0] >> 1) & 0x07 });
            // sps_temporal_id_nesting_flag: u(1) -> bit 7 of first payload byte
            fields.push({ name: "sps_temporal_id_nesting_flag", value: payloadData[0] & 0x01 });

            // --- Structure profile_tier_level() follows (Section 7.3.3) ---
            // This structure is complex and variable length (min 12 bytes).
            // We cannot reliably parse *past* it without a full bitstream reader.
            fields.push({ name: "profile_tier_level()", value: "(Structure skipped - complex & variable length)" });

            // --- sps_seq_parameter_set_id: ue(v) ---
            // This field comes *after* profile_tier_level(). Cannot parse without decoding it.
            fields.push({ name: "sps_seq_parameter_set_id", value: "Requires ue(v) parsing AFTER profile_tier_level()" });

            // --- chroma_format_idc: ue(v) ---
            // This field comes *after* sps_seq_parameter_set_id. Cannot parse.
            // Standard values: 0 (monochrome), 1 (4:2:0), 2 (4:2:2), 3 (4:4:4).
            fields.push({ name: "chroma_format_idc", value: "Requires ue(v) parsing AFTER sps_seq_parameter_set_id" });

            // --- separate_colour_plane_flag: u(1) ---
            // This field is CONDITIONAL: `if( chroma_format_idc == 3 )`
            // It appears *after* chroma_format_idc. Cannot parse.
            fields.push({ name: "separate_colour_plane_flag", value: "Requires parsing chroma_format_idc (after ue(v) fields) and checking condition" });

            // --- pic_width_in_luma_samples: ue(v) ---
            // Comes *after* chroma_format_idc and potential separate_colour_plane_flag.
            // Cannot parse without decoding previous variable-length fields.
            fields.push({ name: "pic_width_in_luma_samples", value: "Requires ue(v) parsing AFTER chroma_format_idc/separate_colour_plane_flag" });

            // --- pic_height_in_luma_samples: ue(v) ---
            // Comes *after* pic_width_in_luma_samples.
            // Cannot parse without decoding previous variable-length fields.
            fields.push({ name: "pic_height_in_luma_samples", value: "Requires ue(v) parsing AFTER pic_width_in_luma_samples" });

             // --- conformance_window_flag: u(1) ---
             // Comes after pic_height_in_luma_samples. Cannot parse accurately as its offset depends on prior ue(v) fields.
             fields.push({ name: "conformance_window_flag", value: "Requires parsing AFTER pic_height_in_luma_samples (ue(v))" });

             // --- Conformance Window Offsets (Conditional & ue(v)) ---
             // These appear ONLY if conformance_window_flag is 1, and *after* that flag.
             // They are ue(v) coded, making them impossible to parse/modify with this simple script.
             fields.push({ name: "conf_win_left_offset", value: "Requires parsing conformance_window_flag (after ue(v)s) AND ue(v) parsing" });
             fields.push({ name: "conf_win_right_offset", value: "Requires parsing conformance_window_flag (after ue(v)s) AND ue(v) parsing" });
             fields.push({ name: "conf_win_top_offset", value: "Requires parsing conformance_window_flag (after ue(v)s) AND ue(v) parsing" });
             fields.push({ name: "conf_win_bottom_offset", value: "Requires parsing conformance_window_flag (after ue(v)s) AND ue(v) parsing" });

            // --- Many more fields follow, often ue(v), se(v) or conditional ---
            // Examples: bit_depth_luma_minus8 ue(v), bit_depth_chroma_minus8 ue(v), log2_max_pic_order_cnt_lsb_minus4 ue(v),
            // sps_sub_layer_ordering_info_present_flag u(1), ... short_term_ref_pic_sets, ...
            // vui_parameters_present_flag u(1)...
            fields.push({ name: "...", value: "(Many more fields require complex parsing: ue(v), se(v), conditionals, loops, VUI, etc.)" });

        } else if (nalType === 34) { // PPS_NUT (Picture Parameter Set, Section 7.3.2.3)
            // pps_pic_parameter_set_id: ue(v) -> Starts at bit 0 of payload
            // pps_seq_parameter_set_id: ue(v) -> Starts after pps_pic_parameter_set_id
            // **Cannot reliably extract these without Exp-Golomb parsing**
            fields.push({ name: "pps_pic_parameter_set_id", value: "Requires Exp-Golomb (ue(v)) parsing" });
            fields.push({ name: "pps_seq_parameter_set_id", value: "Requires Exp-Golomb (ue(v)) parsing AFTER pps_pic_parameter_set_id" });
            // dependent_slice_segments_enabled_flag: u(1) -> Comes after pps_seq_parameter_set_id
            fields.push({ name: "dependent_slice_segments_enabled_flag", value: "Requires parsing AFTER pps_seq_parameter_set_id (ue(v))" });
             // --- Many more fields follow, heavily dependent on ue(v), se(v) and flags ---
            fields.push({ name: "...", value: "(Many more fields require complex parsing)" });

        } else if (nalType === 35) { // AUD_NUT (Access Unit Delimiter, Section 7.3.2.4)
             if (payloadData.length < 1) {
                 fields.push({ name: "Payload Error", value: "Too short for AUD pic_type field."});
                 return fields;
             }
            // pic_type: u(3) -> bits 0-2 of first payload byte
             fields.push({ name: "pic_type", value: (payloadData[0] >> 5) & 0x07 });
             // The remaining 5 bits are reserved (should be 0) but not parsed here.
             // H.265 Table 7-6 defines pic_type values (0: I, B, P; 1: I, P; 2: I; etc.)
        }
        // Add parsing logic for other NAL types here if needed and feasible with the limited approach.
        // SEI (39, 40) parsing is particularly complex due to variable payload types and lengths.
        // Slice segments (0-23) parsing is extremely complex (slice header, then coded data).

    } catch (e) {
        console.error("Error during basic parsing of NAL unit payload (Type " + nalType + "): ", e);
        // Add a field indicating a general parse error for this NAL unit
        fields.push({ name: "Parsing Error", value: "Could not reliably extract simple fields. Check console."});
    }
    return fields;
}

function displayFields(nalName, fields, nalUnitType, layerId, temporalId, nalIndex) { // Added nalIndex
    const container = document.getElementById("fieldsContainer");
    const nalDiv = document.createElement("div");
    nalDiv.className = "nal-unit";
    // Include NAL index and header info in the header for context
    nalDiv.innerHTML = `<h3>#${nalIndex}: ${nalName} (Type ${nalUnitType}, LId ${layerId}, TId ${temporalId})</h3>`;

    if (fields.length === 0) {
        nalDiv.innerHTML += `<p>No fields parsed for this NAL unit.</p>`;
    } else {
        fields.forEach((field, fieldIndex) => {
            const fieldDiv = document.createElement("div");
            fieldDiv.className = "field";
            // Use a unique ID including NAL index and field name/index for the input element
            const inputId = `nal-${nalIndex}-field-${field.name.replace(/[^a-zA-Z0-9_]/g, '_')}-${fieldIndex}`;

            // Determine if the field *might* be editable based on its name and current value
            // This is a heuristic - it doesn't guarantee the modification will work correctly.
            const isPotentiallyEditable =
                // Exclude placeholder/info fields explicitly
                !field.name.endsWith("...") &&
                !field.name.includes(" Error") && // Exclude "Payload Error", "Parsing Error"
                !field.name.includes("(Structure skipped") &&
                !field.name.includes("Requires ") && // Excludes "Requires Exp-Golomb", "Requires ue(v)..." etc.
                !field.name.startsWith("reserved") && // Generally don't edit reserved fields (though possible)
                // Specific non-editable fields based on parsing limitations
                field.name !== 'sps_seq_parameter_set_id' &&
                field.name !== 'chroma_format_idc' &&
                field.name !== 'separate_colour_plane_flag' &&
                field.name !== 'pic_width_in_luma_samples' && // Explicitly disable fields requiring ue(v) or complex offsets
                field.name !== 'pic_height_in_luma_samples' && // Explicitly disable the height field too
                field.name !== 'conformance_window_flag' && // Explicitly disable the conformance window flag too
                field.name !== 'conf_win_left_offset' && // Explicitly disable the conformance window offsets
                field.name !== 'conf_win_right_offset' && // Explicitly disable the conformance window offsets
                field.name !== 'conf_win_top_offset' && // Explicitly disable the conformance window offsets
                field.name !== 'conf_win_bottom_offset' && // Explicitly disable the conformance window offsets
                field.name !== 'pps_pic_parameter_set_id' &&
                field.name !== 'pps_seq_parameter_set_id' &&
                field.name !== 'dependent_slice_segments_enabled_flag';
                // Add more specific field names here if they are parsed but shouldn't be edited

            const disabledAttr = isPotentiallyEditable ? "" : "disabled";
            const titleAttr = isPotentiallyEditable ? "" : `title="Parsing or Editing not supported for this field type/value in this tool due to H.265 complexity (e.g., Exp-Golomb, variable offsets, conditionals)."`;

            // Use text input for simplicity; number validation happens on modification attempt
            fieldDiv.innerHTML = `<label for="${inputId}">${field.name}:</label> <input type="text" id="${inputId}" data-nal-index="${nalIndex}" data-field-name="${field.name}" value="${field.value}" ${disabledAttr} ${titleAttr}>`;

            // Store the original value as initially displayed (on the input itself for simplicity)
            fieldDiv.querySelector('input').defaultValue = field.value;
            nalDiv.appendChild(fieldDiv);
        });
    }

    container.appendChild(nalDiv);
}


document.getElementById("downloadBtn").addEventListener("click", function() {
    // Attempt to modify the stream based on user input in enabled fields
    const modifiedData = modifyStream();
    if (!modifiedData) {
        console.error("Modification process failed or was cancelled. Download aborted.");
        alert("Modification process failed or encountered errors. Check console for details. Download aborted.");
        return; // Don't proceed with download if modification failed
    }

    // Create a Blob from the modified data
    const blob = new Blob([modifiedData], { type: "video/H265" }); // More specific MIME type
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none"; // Hide the link
    a.href = url;
    a.download = "updated.h265"; // Set the download filename

    document.body.appendChild(a); // Append the link to the body (required for Firefox)
    a.click(); // Simulate a click to trigger the download

    // Clean up: remove the link and revoke the object URL
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    console.log("Modified file download initiated.");
});

function modifyStream() {
    // ** IMPORTANT WARNING **
    console.warn("modifyStream function has SEVERE LIMITATIONS. It can ONLY reliably modify simple, fixed-bit-length fields (u(n)) located at the very BEGINNING of VPS, SPS, or AUD payloads. It CANNOT handle Exp-Golomb fields (like pic_width/height_in_luma_samples, conformance_window_flag, conf_win_left_offset, conf_win_right_offset, conf_win_top_offset, conf_win_bottom_offset), fields after variable-length structures (like profile_tier_level), conditional fields, or fields requiring emulation prevention byte handling. Modifications to other fields will likely CORRUPT the bitstream.");

    if (!originalData) {
        console.error("Original data is not loaded. Cannot modify.");
        return null;
    }
    // Create a mutable copy of the original data to work on
    const modified = new Uint8Array(originalData);
    let modifiedNalsIndices = new Set(); // Track which NAL display indices have pending modifications
    let modificationErrorsOccurred = false; // Flag to track if any applyModificationsToNal failed

    try {
        // 1. Identify all enabled input fields where the value has actually changed
        const inputs = document.querySelectorAll('#fieldsContainer input[type="text"]:not([disabled])');
        if (inputs.length === 0) {
            console.log("No potentially modifiable fields found or enabled.");
            return modified; // Return the original data if no editable fields exist
        }

        // Group changed inputs by their NAL display index
        const editsByNal = {};
        inputs.forEach(input => {
            // Only process if the current value is different from the initially displayed value (defaultValue)
            if (input.value !== input.defaultValue) {
                 const nalDisplayIndex = parseInt(input.getAttribute('data-nal-index'), 10);
                 if (isNaN(nalDisplayIndex)) {
                     console.warn("Skipping input with invalid NAL index attribute:", input.id);
                     return; // Skip this input
                 }
                 if (!editsByNal[nalDisplayIndex]) {
                     editsByNal[nalDisplayIndex] = [];
                 }
                 editsByNal[nalDisplayIndex].push(input);
                 modifiedNalsIndices.add(nalDisplayIndex); // Mark this NAL index as needing processing
            }
        });

        if (modifiedNalsIndices.size === 0) {
            console.log("No values were changed from their original state in editable fields.");
            return modified; // Return the original data if no values were actually changed
        }

        console.log(`Attempting to apply modifications to ${modifiedNalsIndices.size} NAL unit(s) based on changed input fields: Indices ${[...modifiedNalsIndices].join(', ')}`);

        // 2. Re-iterate through the original bitstream to find NAL units and apply changes
        // This is similar to extractNALUnits but operates on the 'modified' buffer
        // and applies changes when a NAL unit corresponding to a modified index is found.
        let nalCount = 0;
        let nalStartOffset = -1; // Byte offset in 'modified' where the current NAL unit *payload* starts
        let nalHeaderStartOffset = -1; // Byte offset where the NAL *header* starts
        let currentNalType = -1;

        for (let i = 0; i < modified.length - 2; i++) {
            let isStartCode3 = false;
            let isStartCode4 = false;
            let startCodeLen = 0;

            if (i + 3 < modified.length && modified[i] === 0 && modified[i + 1] === 0 && modified[i + 2] === 0 && modified[i + 3] === 1) {
                isStartCode4 = true;
                startCodeLen = 4;
            } else if (modified[i] === 0 && modified[i + 1] === 0 && modified[i + 2] === 1) {
                isStartCode3 = true;
                startCodeLen = 3;
            }

            if (isStartCode3 || isStartCode4) {
                // If we were inside a NAL unit, process it now before starting the next one
                if (nalHeaderStartOffset !== -1) {
                    if (modifiedNalsIndices.has(nalCount)) {
                        // Check header validity before proceeding
                        if (nalHeaderStartOffset + 1 < i) { // Ensure NAL has at least a 2-byte header
                            nalStartOffset = nalHeaderStartOffset + 2; // Payload starts after 2-byte header
                            currentNalType = (modified[nalHeaderStartOffset] >> 1) & 0x3F;
                            console.log(`Applying modifications for NAL #${nalCount}, Type ${currentNalType}, Header Offset ${nalHeaderStartOffset}, Payload Offset ${nalStartOffset}`);
                            try {
                                applyModificationsToNal(modified, nalStartOffset, i, currentNalType, editsByNal[nalCount]);
                                // Successfully applied modifications for this NAL
                            } catch (error) {
                                // applyModificationsToNal throws on error
                                console.error(`Failed to apply modifications to NAL #${nalCount}: ${error.message}. Aborting further modifications for this NAL.`);
                                modificationErrorsOccurred = true; // Mark that an error happened
                                // Still remove from set, but note the failure occurred
                            }
                        } else {
                            console.error(`NAL #${nalCount} found at offset ${nalHeaderStartOffset} is too short (less than 2 bytes for header). Cannot modify.`);
                            modificationErrorsOccurred = true; // Mark error
                        }
                         modifiedNalsIndices.delete(nalCount); // Mark this NAL index as processed (or failed)
                    }
                    nalCount++; // Increment NAL counter *after* processing the previous one
                }
                // Mark the start of the *new* NAL unit's header
                nalHeaderStartOffset = i + startCodeLen;
                // Optimization: Skip past the start code bytes
                i = nalHeaderStartOffset - 1; // Loop increment will move to the first byte of the header
            }
        }

        // Process the very last NAL unit in the stream (if one was started)
        if (nalHeaderStartOffset !== -1) {
            if (modifiedNalsIndices.has(nalCount)) {
                 if (nalHeaderStartOffset + 1 < modified.length) { // Check header validity
                    nalStartOffset = nalHeaderStartOffset + 2;
                    currentNalType = (modified[nalHeaderStartOffset] >> 1) & 0x3F;
                    console.log(`Applying modifications for LAST NAL #${nalCount}, Type ${currentNalType}, Header Offset ${nalHeaderStartOffset}, Payload Offset ${nalStartOffset}`);
                     try {
                         // Pass modified.length as the end offset for bounds checking
                        applyModificationsToNal(modified, nalStartOffset, modified.length, currentNalType, editsByNal[nalCount]);
                        // Successfully applied modifications
                    } catch (error) {
                        console.error(`Failed to apply modifications to LAST NAL #${nalCount}: ${error.message}.`);
                        modificationErrorsOccurred = true; // Mark error
                    }
                 } else {
                     console.error(`LAST NAL #${nalCount} at offset ${nalHeaderStartOffset} is too short for header. Cannot modify.`);
                     modificationErrorsOccurred = true; // Mark error
                 }
                 modifiedNalsIndices.delete(nalCount); // Mark as processed (or failed)
            }
            // No need to increment nalCount here as it represents the index of the last NAL
        }


        // 3. Final Check: Ensure all intended modifications were attempted and report errors
        if (modifiedNalsIndices.size > 0) {
            // This shouldn't happen if the loop logic is correct, but check anyway
            console.error(`Modification process failed: Could not find NAL unit indices: ${[...modifiedNalsIndices].join(', ')}.`);
            modificationErrorsOccurred = true;
        }

        if (modificationErrorsOccurred) {
            console.error("Errors occurred during the modification process. The resulting file may be corrupted or incomplete. Check previous logs.");
            // Return null to indicate failure to the download handler
            return null;
        }

        console.log("Finished applying modifications (within supported limits).");
        return modified; // Return the modified byte array

    } catch (error) {
        console.error("Unexpected error during the modification process:", error);
        // Return null to indicate a general failure
        return null;
    }
}

// Helper function to apply modifications to a specific NAL unit's payload data
// WARNING: This function has the same limitations as modifyStream. It only handles
//          a few specific fixed-bit fields at the absolute beginning of the payload.
//          IT CANNOT MODIFY Exp-Golomb fields like pic_width/height_in_luma_samples,
//          conformance_window_flag, or conf_win_left_offset/conf_win_right_offset/conf_win_top_offset/conf_win_bottom_offset (and related) or fields after them.
function applyModificationsToNal(modifiedData, payloadOffset, payloadEndOffset, nalType, inputsToApply) {
    // Basic validation of offsets
    if (payloadOffset < 0 || payloadOffset > modifiedData.length || payloadEndOffset < payloadOffset || payloadEndOffset > modifiedData.length) {
        throw new Error(`Invalid payload offsets (Start: ${payloadOffset}, End: ${payloadEndOffset}) for NAL type ${nalType}.`);
    }
     if (!inputsToApply || inputsToApply.length === 0) {
        console.warn(`No input fields provided for modification at NAL payload offset ${payloadOffset}. Skipping.`);
        return; // Nothing to do
    }

    const payloadLength = payloadEndOffset - payloadOffset;

    inputsToApply.forEach(input => {
         const fieldName = input.getAttribute('data-field-name');
         const newValueStr = input.value;
         let newValue;

         // Helper to check if the required bytes are within the payload boundaries
         const checkPayloadBounds = (byteIndex, bytesNeeded = 1) => {
             if (byteIndex < 0 || byteIndex + bytesNeeded > payloadLength) {
                 throw new Error(`Payload too short (length ${payloadLength}) to write '${fieldName}' at byte index ${byteIndex}. Needs ${bytesNeeded} byte(s). Offset: ${payloadOffset}`);
             }
         };

         try {
             // --- NAL Header Fields ---
             // Modification of header fields is generally complex and not implemented here.
             // e.g., changing nal_unit_type could break the stream.
             // If header fields were made editable, their logic would go here, operating
             // on bytes at `payloadOffset - 2` and `payloadOffset - 1`, with careful bounds checking.

             // --- VPS Fields (Type 32) --- Applicable only if nalType is 32
             if (nalType === 32) {
                 if (fieldName === 'vps_video_parameter_set_id') { // u(4) in byte 0
                     checkPayloadBounds(0);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 15) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0-15.`);
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0x0F) | (newValue << 4);
                 } else if (fieldName === 'vps_base_layer_internal_flag') { // u(1) in byte 0
                     checkPayloadBounds(0);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0 or 1.`);
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 3)) | (newValue << 3);
                 } else if (fieldName === 'vps_base_layer_available_flag') { // u(1) in byte 0
                     checkPayloadBounds(0);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0 or 1.`);
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 2)) | (newValue << 2);
                 } else if (fieldName === 'vps_max_layers_minus1') { // u(6) spanning byte 0/1
                     checkPayloadBounds(0, 2); // Need bytes 0 and 1
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 63) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0-63.`);
                     // Clear bits 6-7 of byte 0, then set them from bits 4-5 of newValue
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFC) | ((newValue >> 4) & 0x03);
                     // Clear bits 0-3 of byte 1, then set them from bits 0-3 of newValue
                     modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0x0F) | ((newValue & 0x0F) << 4);
                 } else if (fieldName === 'vps_max_sub_layers_minus1') { // u(3) in byte 1
                     checkPayloadBounds(1);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0-7.`);
                     // Clear bits 4-6 of byte 1 (mask 0000 1110), then set them
                     modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & ~0x0E) | (newValue << 1);
                 } else if (fieldName === 'vps_temporal_id_nesting_flag') { // u(1) in byte 1
                     checkPayloadBounds(1);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0 or 1.`);
                      // Clear bit 7 of byte 1 (mask 0000 0001), then set it
                     modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & ~0x01) | (newValue & 0x01);
                 }
                 // Note: vps_reserved_0xffff_16bits is marked as non-editable, so no modification logic here.
                 else {
                      // This case handles attempts to modify fields that were potentially editable
                      // but don't have specific modification logic here (should not happen with current setup).
                      console.warn(`Modification logic for field '${fieldName}' in NAL type ${nalType} is not implemented or field is beyond the reliably modifiable range. Skipping modification for this field.`);
                 }
             }
             // --- SPS Fields (Type 33) --- Applicable only if nalType is 33
             else if (nalType === 33) {
                 if (fieldName === 'sps_video_parameter_set_id') { // u(4) in byte 0
                     checkPayloadBounds(0);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 15) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0-15.`);
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0x0F) | (newValue << 4);
                 } else if (fieldName === 'sps_max_sub_layers_minus1') { // u(3) in byte 0
                     checkPayloadBounds(0);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0-7.`);
                     // Clear bits 4-6 of byte 0 (mask 0000 1110), then set them
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~0x0E) | (newValue << 1);
                 } else if (fieldName === 'sps_temporal_id_nesting_flag') { // u(1) in byte 0
                     checkPayloadBounds(0);
                     newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 1) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0 or 1.`);
                      // Clear bit 7 of byte 0 (mask 0000 0001), then set it
                      modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~0x01) | (newValue & 0x01);
                 }
                 // IMPORTANT: Cannot modify any fields after these initial ones (e.g., profile_tier_level,
                 // sps_seq_parameter_set_id, chroma_format_idc, pic_width_in_luma_samples, pic_height_in_luma_samples,
                 // conformance_window_flag, conf_win_left_offset, conf_win_right_offset, conf_win_top_offset, conf_win_bottom_offset, etc.) because their offsets are unknown
                 // and/or they use Exp-Golomb encoding.
                 // The input fields for these should be disabled by displayFields.
                 else {
                      // Throw an error if modification is attempted for known complex/unsupported fields
                      if (fieldName === 'pic_width_in_luma_samples' ||
                          fieldName === 'pic_height_in_luma_samples' ||
                          fieldName === 'conformance_window_flag' ||
                          fieldName === 'conf_win_left_offset' ||
                          fieldName === 'conf_win_right_offset' ||
                          fieldName === 'conf_win_top_offset' || // Explicit check
                          fieldName === 'conf_win_bottom_offset' || // Explicit check
                          fieldName === 'sps_seq_parameter_set_id' ||
                          fieldName === 'chroma_format_idc' ||
                          fieldName === 'separate_colour_plane_flag' ||
                          fieldName === 'dependent_slice_segments_enabled_flag') { // Added from PPS context, applies conceptually here too
                            throw new Error(`FATAL: Attempted to modify '${fieldName}' which requires Exp-Golomb parsing/writing or complex offset calculation, not supported by this tool.`);
                      }
                      // Warn for any other unexpected editable fields
                      console.warn(`Modification logic for field '${fieldName}' in NAL type ${nalType} is not implemented or field is beyond the reliably modifiable range (e.g., requires Exp-Golomb or offset calculation). Skipping modification for this field.`);
                 }
             }
             // --- AUD Fields (Type 35) --- Applicable only if nalType is 35
             else if (nalType === 35) {
                  if (fieldName === 'pic_type') { // u(3) in byte 0
                      checkPayloadBounds(0);
                      newValue = parseInt(newValueStr, 10);
                     if (isNaN(newValue) || newValue < 0 || newValue > 7) throw new Error(`Invalid value for ${fieldName}: '${newValueStr}'. Must be 0-7.`);
                     // Clear bits 0-2 of byte 0 (mask 1110 0000), then set them (These are bits 5, 6, 7 in the byte)
                     modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~0xE0) | (newValue << 5);
                 }
                 else {
                      console.warn(`Modification logic for field '${fieldName}' in NAL type ${nalType} is not implemented or field is beyond the reliably modifiable range. Skipping modification for this field.`);
                 }
             }
             // --- Add other NAL types IF simple, fixed-bit fields at the start need modification ---
             else {
                 // Log if an editable field from an unsupported NAL type was changed
                 console.warn(`Modification requested for field '${fieldName}' in NAL type ${nalType}, but modification logic for this NAL type is not implemented. Skipping modification for this field.`);
             }

         } catch (err) {
             // Log the specific error encountered during modification attempt for this field
             // and re-throw it to signal failure for the entire NAL unit in modifyStream.
             console.error(`Error applying modification for field '${fieldName}' (New Value: '${newValueStr}') in NAL type ${nalType} at payload offset ${payloadOffset}: ${err.message}`);
             throw err; // Propagate error up to modifyStream
         }
    });
}
