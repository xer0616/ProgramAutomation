
const version = 9
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
    let nalStart = -1; // Start position of the NAL unit payload (byte after start code)
    let zeroCount = 0;

    for (let i = 0; i < data.length; i++) {
        if (zeroCount >= 2 && data[i] === 1) { // Found potential start code (00 00 01 or 00 00 00 01)
            const startCodeLen = zeroCount === 2 ? 3 : 4;
            const currentNalUnitDataStart = i + 1; // Position after the start code

            if (nalStart !== -1) {
                // Process the *previous* NAL unit
                // The data for the previous NAL unit starts *after* its start code (at nalStart)
                // and ends *before* the current start code (at i - startCodeLen).
                // NAL unit *includes* its header.
                const nalHeaderOffset = nalStart; // The NAL unit payload starts here
                const nalUnitEndOffset = i - startCodeLen; // End of the NAL unit data
                // Ensure we don't create a negative length subarray if NAL units are back-to-back
                if (nalUnitEndOffset > nalHeaderOffset) {
                     processNalUnit(data.subarray(nalHeaderOffset, nalUnitEndOffset));
                     nalUnitCount++;
                } else if (nalUnitEndOffset === nalHeaderOffset) {
                    // Handle potentially empty NAL units (e.g., header only after a start code)
                    // Although unlikely for most types, it's possible.
                    // processNalUnit(data.subarray(nalHeaderOffset, nalUnitEndOffset)); // Process potentially empty slice
                     // console.warn("Found zero-length NAL unit payload between start codes.");
                     // Decide if processing zero-length payload makes sense based on spec for specific NAL types
                }

            }

            // Start of the new NAL unit payload
            nalStart = currentNalUnitDataStart;

            // Reset zero count
            zeroCount = 0;

        } else if (data[i] === 0) {
            zeroCount++;
        } else {
            zeroCount = 0;
        }
    }

    // Process the last NAL unit if the file doesn't end with a start code
    if (nalStart !== -1 && nalStart < data.length) {
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
    // The input nalUnitData is the NAL unit *payload* starting immediately after the start code.
    // It contains the 2-byte NAL header followed by the RBSP data.
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
    // nuh_layer_id u(6) is bits 5..0 of byte 0 + bits 7..3 of byte 1
    const nuhLayerId = ((headerByte1 & 0x01) << 5) | (headerByte2 >> 3); // Corrected extraction
    // nuh_temporal_id_plus1 u(3) is bits 2..0 of byte 1
    const nuhTemporalIdPlus1 = headerByte2 & 0x07;


    const nalName = getNALName(nalType);

    if (forbiddenZeroBit !== 0) {
        console.warn(`Forbidden zero bit is not zero (${forbiddenZeroBit}) for NAL Unit ${nalName} (${nalType}).`);
    }
    if (nuhTemporalIdPlus1 === 0) {
        // Spec 7.3.1.1: nuh_temporal_id_plus1 shall not be equal to 0.
        console.warn(`WARNING: nuh_temporal_id_plus1 is zero for NAL Unit ${nalName} (${nalType}), which is forbidden by H.265 spec 7.3.1.1.`);
    }

    // The NAL unit payload (RBSP) starts after the 2-byte header.
    const rbspData = nalUnitData.subarray(2);

    // --- RBSP Handling ---
    // For accurate parsing (especially of ue(v)/se(v) fields), emulation prevention bytes (0x03)
    // need to be removed from the rbspData. 0x000003 -> 0x0000.
    // This simple script currently DOES NOT DO THIS, leading to potential inaccuracies.
    // We pass the raw rbspData to extractFields for simplicity, acknowledging the limitation.
    // const parsedRbspData = removeEmulationPrevention(rbspData); // Ideal step
    const parsedRbspData = rbspData; // Using raw data for now

    // Extract fields based on NAL type from the (potentially unescaped) RBSP
    const fields = extractFields(nalType, parsedRbspData);

    // Display the extracted fields
    displayFields(nalName, nalType, fields, nuhLayerId, nuhTemporalIdPlus1); // Pass header fields
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
        // 24-31 Reserved VCL (non-IRAP)
        32: "VPS_NUT",        // Video Parameter Set
        33: "SPS_NUT",        // Sequence Parameter Set
        34: "PPS_NUT",        // Picture Parameter Set
        35: "AUD_NUT",        // Access Unit Delimiter
        36: "EOS_NUT",        // End of Sequence
        37: "EOB_NUT",        // End of Bitstream
        38: "FD_NUT",         // Filler Data
        39: "PREFIX_SEI_NUT", // Supplemental enhancement information (SEI) prefix
        40: "SUFFIX_SEI_NUT", // Supplemental enhancement information (SEI) suffix
        // 41-47 Reserved non-VCL (RSV_NVCL)
        // 48-63 Unspecified (UNSPEC)
    };
    if (nalType >= 10 && nalType <= 15) return nalMap[nalType] || `RSV_VCL (${nalType})`; // Reserved VCL
    if (nalType >= 22 && nalType <= 23) return nalMap[nalType] || `RSV_IRAP_VCL (${nalType})`; // Reserved IRAP VCL
    if (nalType >= 24 && nalType <= 31) return `RSV_VCL (${nalType})`; // Reserved non-IRAP VCL
    if (nalType >= 41 && nalType <= 47) return `RSV_NVCL (${nalType})`; // Reserved non-VCL
    if (nalType >= 48 && nalType <= 63) return `UNSPEC (${nalType})`; // Unspecified

    return nalMap[nalType] || `Reserved/Unknown (${nalType})`;
}

function extractFields(nalType, payloadData) {
    // --- IMPORTANT ---
    // This function provides a VERY simplified extraction for specific fields
    // based on direct byte access *without* proper RBSP handling (emulation prevention)
    // or bitstream parsing (like Exp-Golomb). Inaccurate for many fields.
    // --- ---
    let fields = [];
    let currentBitOffset = 0; // Track bits conceptually

    if (payloadData.length < 1 && ![36, 37, 38].includes(nalType) /* EOS/EOB/FD can be empty */) {
       // Allow processing to continue for empty NALs like EOS/EOB/FD
    }

    try {
        if (nalType === 32) { // VPS_NUT (Video Parameter Set - ITU-T H.265 Section 7.3.2.1)
            // Check sufficient length for the fixed initial fields
            if (payloadData.length < 4) { // Need at least 4 bytes for fields up to vps_reserved_0xffff_16bits
                fields.push({ name: "ERROR", value: "Payload too short for initial VPS fields", type: 'error' });
                return fields;
            }
            currentBitOffset = 0;

            // vps_video_parameter_set_id: u(4) -> Upper 4 bits of payload byte 0
            const vps_video_parameter_set_id = (payloadData[0] >> 4) & 0x0F;
            fields.push({ name: "vps_video_parameter_set_id", value: vps_video_parameter_set_id, bits: 4, type: 'u' });
            currentBitOffset += 4;

            // vps_reserved_three_2bits: f(2) -> bits 3-2 of payload byte 0
            const vps_reserved_three_2bits = (payloadData[0] >> 2) & 0x03;
            if (vps_reserved_three_2bits !== 3) {
                console.warn(`VPS vps_reserved_three_2bits not equal to 3 (found ${vps_reserved_three_2bits})`);
            }
            fields.push({ name: "vps_reserved_three_2bits", value: vps_reserved_three_2bits, bits: 2, type: 'f' });
            currentBitOffset += 2;

            // vps_max_layers_minus1: u(6) -> bits 1-0 of byte 0, and bits 7-4 of byte 1
            const val_byte0 = (payloadData[0] & 0x03); // Lower 2 bits
            const val_byte1_hi = (payloadData[1] >> 4) & 0x0F; // Upper 4 bits
            const vps_max_layers_minus1 = (val_byte0 << 4) | val_byte1_hi;
            fields.push({ name: "vps_max_layers_minus1", value: vps_max_layers_minus1, bits: 6, type: 'u'});
            currentBitOffset += 6; // Now at 12 bits total

            // vps_max_sub_layers_minus1: u(3) -> bits 3-1 of byte 1
            const vps_max_sub_layers_minus1 = (payloadData[1] >> 1) & 0x07;
            fields.push({ name: "vps_max_sub_layers_minus1", value: vps_max_sub_layers_minus1, bits: 3, type: 'u' });
            currentBitOffset += 3; // Now at 15 bits total

            // vps_temporal_id_nesting_flag: u(1) -> bit 0 of byte 1
            const vps_temporal_id_nesting_flag = payloadData[1] & 0x01;
            fields.push({ name: "vps_temporal_id_nesting_flag", value: vps_temporal_id_nesting_flag, bits: 1, type: 'u' });
            currentBitOffset += 1; // Now at 16 bits total (2 bytes)

            // vps_reserved_0xffff_16bits: f(16) -> Bytes 2 and 3
            const vps_reserved_0xffff_16bits = (payloadData[2] << 8) | payloadData[3];
            if (vps_reserved_0xffff_16bits !== 0xFFFF) {
                 console.warn(`VPS reserved bits are not 0xFFFF (found 0x${vps_reserved_0xffff_16bits.toString(16)})`);
            }
            fields.push({ name: "vps_reserved_0xffff_16bits", value: `0x${payloadData[2].toString(16).padStart(2, '0')}${payloadData[3].toString(16).padStart(2, '0')}`, bits: 16, type: 'f' });
            currentBitOffset += 16; // Now at 32 bits total (4 bytes)

            // --- IMPORTANT PARSING LIMITATION ---
            // The profile_tier_level structure follows here. Its size is variable.
            // The current code does NOT parse profile_tier_level.
            // Therefore, the *exact* bit offset of subsequent fields cannot be determined reliably.
            // We will add subsequent fields as placeholders.
            // --- ---

            // Placeholder for the complex profile_tier_level structure
            fields.push({ name: "profile_tier_level(...)", value: "...", type: 'struct', comment: `Complex structure. Size depends on vps_max_sub_layers_minus1 (${vps_max_sub_layers_minus1}). Parsing not implemented.` });
            // Approximate offset increase
            currentBitOffset += 96; // Minimum size estimate

            // vps_sub_layer_ordering_info_present_flag: u(1) - Placeholder
            fields.push({
                name: "vps_sub_layer_ordering_info_present_flag",
                value: "...",
                bits: 1,
                type: 'u',
                comment: "Position depends on variable size of profile_tier_level structure. Parsing not implemented."
            });
            currentBitOffset += 1; // Conceptual increment

            // Placeholders for conditional loops
             fields.push({ name: "vps_max_dec_pic_buffering_minus1[...]", value: "...", type: 'ue[]', comment: "Requires parsing loop based on preceding flag/values" });
             fields.push({ name: "vps_max_num_reorder_pics[...]", value: "...", type: 'ue[]', comment: "Requires parsing loop" });
             fields.push({ name: "vps_max_latency_increase_plus1[...]", value: "...", type: 'ue[]', comment: "Requires parsing loop" });
             // Approximate offset increase
             // currentBitOffset += ... (highly variable);

             // vps_max_layer_id: u(6) - Placeholder
             fields.push({
                name: "vps_max_layer_id",
                value: "...",
                bits: 6,
                type: 'u',
                comment: `Present only if vps_max_layers_minus1 (${vps_max_layers_minus1}) > 0. Position depends on preceding variable-size structures. Parsing not implemented.`
             });
             // Approximate offset increase
             // currentBitOffset += 6; // (Only if present)

             // vps_num_layer_sets_minus1: ue(v) - Placeholder
              fields.push({
                 name: "vps_num_layer_sets_minus1",
                 value: "...",
                 type: 'ue',
                 comment: "Variable length Exp-Golomb. Position depends on preceding variable-size structures. Parsing not implemented."
              });
              // Approximate offset increase
              // currentBitOffset += ... (variable);

              // Placeholder for layer_id_included_flag[i][j] loop
              // This flag is actually inside vps_extension() syntax, which is conditional itself.
              // Add placeholder for vps_extension_flag first.
             fields.push({
                 name: "vps_timing_info_present_flag",
                 value: "...",
                 bits: 1,
                 type: 'u',
                 comment: "Position depends on preceding structures/loops. Parsing not implemented."
             });
             // Approximate offset increase
             // currentBitOffset += 1;
             fields.push({
                 name: "vps_timing_info()",
                 value: "...",
                 type: 'struct',
                 comment: "Present if vps_timing_info_present_flag=1. Complex structure. Parsing not implemented."
             });
             // Approximate offset increase
             // currentBitOffset += ... (variable);

             fields.push({
                 name: "vps_extension_flag",
                 value: "...",
                 bits: 1,
                 type: 'u',
                 comment: "Controls presence of vps_extension(). Position depends on preceding structures. Parsing not implemented."
             });
             // Approximate offset increase
             // currentBitOffset += 1;

             // *** ADDING Placeholder related to layer_id_included_flag ***
             // This flag itself is *within* the vps_extension() syntax structure (H.265 7.3.2.1.1),
             // specifically inside a loop controlled by vps_num_layer_sets_minus1.
             // Represent the conditional vps_extension() structure itself.
             fields.push({
                 name: "vps_extension()",
                 value: "...",
                 type: 'struct',
                 comment: "Present only if vps_extension_flag=1. Contains fields like layer_id_included_flag[i][j] within loops. Full parsing not implemented."
             });

             // Final placeholder for any remaining bits/flags
             fields.push({ name: "vps_rbsp_trailing_bits()", value: "...", type: 'bits', comment: "Trailing bits. Parsing not implemented."});


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
             fields.push({ name: "profile_tier_level(...)", value: "...", type: 'struct', comment: `Complex structure. Size depends on sps_max_sub_layers_minus1 (${sps_max_sub_layers_minus1}). Parsing not implemented.` });

            // The *next* fields require Exp-Golomb decoding and knowledge of profile_tier_level size
            fields.push({ name: "sps_seq_parameter_set_id", value: "...", type: 'ue', comment: "Exp-Golomb encoded, after profile_tier_level" }); // Placeholder - requires proper parsing
            fields.push({ name: "chroma_format_idc", value: "...", type: 'ue', comment: "Exp-Golomb encoded" }); // Placeholder
            // ... other fields ...
            if (payloadData.length > currentBitOffset / 8) { // Indicate more data exists (approximate)
                 fields.push({ name: "sps_remaining_data", value: "...", type: 'data', comment: "Many fields follow, requires full Exp-Golomb parsing (e.g., pic_width_in_luma_samples, conformance_window_flag...)"});
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
                 fields.push({ name: "pps_remaining_data", value: "...", type: 'data', comment: "Many fields follow (e.g., num_extra_slice_header_bits, sign_data_hiding_enabled_flag...), requires full parsing." });
             }
        } else if (nalType === 35) { // AUD_NUT (Access Unit Delimiter - ITU-T H.265 Section 7.3.2.5)
             if (payloadData.length >= 1) {
                // pic_type: u(3) -> bits 7-5 of the first payload byte
                const pic_type = (payloadData[0] >> 5) & 0x07;
                const picTypeMap = { 0: 'I', 1: 'P, I', 2: 'B, P, I', 3: 'SI', 4: 'SP, SI', 5: 'P, I, SP, SI', 6: 'B, P, I, SP, SI', 7: 'B, P, I, SP, SI'};
                fields.push({ name: "pic_type", value: `${pic_type} (${picTypeMap[pic_type] || 'Unknown'})`, bits: 3, type: 'u', dataValue: pic_type }); // Store raw value too
                // No other fields defined in AUD RBSP syntax
             } else {
                 fields.push({ name: "ERROR", value: "Payload too short for AUD fields", type: 'error' });
             }
        } else if (nalType === 39 || nalType === 40) { // PREFIX_SEI_NUT or SUFFIX_SEI_NUT
            // SEI messages are complex (list of messages, each with type/size/payload)
             fields.push({ name: "SEI Message(s)", value: "...", type: 'complex', comment: "Requires full SEI message parsing (type, size, payload loops)" });
             if (payloadData.length > 0) {
                  fields.push({ name: "sei_data_preview", value: `[${payloadData.slice(0, Math.min(8, payloadData.length)).map(b => b.toString(16).padStart(2,'0')).join(' ')}...]`, type: 'data' });
             }
        }
        // Add extraction logic for other NAL types if needed (e.g., FD_NUT)
        else if (nalType === 36 || nalType === 37) { // EOS_NUT (36), EOB_NUT (37)
             // No syntax elements in their RBSP.
             fields.push({ name: "Note", value: "No payload fields defined", type: 'info' });
        }
        else if (nalType === 38) { // FD_NUT (Filler Data)
             fields.push({ name: "Note", value: "Filler Data (payload typically 0xFF bytes)", type: 'info' });
             if (payloadData.length > 0) {
                 fields.push({ name: "filler_data_preview", value: `[${payloadData.slice(0, Math.min(8, payloadData.length)).map(b => b.toString(16).padStart(2,'0')).join(' ')}...] (${payloadData.length} bytes)`, type: 'data' });
             }
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
        { name: "nuh_layer_id", value: nuhLayerId, bits: 6, type: 'u', comment: "From NAL Header (H.265 Spec 7.3.1.1)" },
        { name: "nuh_temporal_id_plus1", value: nuhTemporalIdPlus1, bits: 3, type: 'u', comment: "From NAL Header (TemporalID = Value - 1)" }
    ];

    headerFields.forEach((field, index) => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field header-field"; // Add class to distinguish header fields

        // Use a unique identifier (include NAL count for more robustness if needed)
        const sanitizedFieldName = field.name.replace(/\W/g, '_');
        const inputId = `nal-${nalType}-header-${sanitizedFieldName}-${index}`; // Use index for uniqueness if multiple NALs of same type exist

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
        const sanitizedFieldName = field.name.replace(/\W/g, '_');
        // Append 'payload' to avoid ID collision with potential header fields of the same name
        const inputId = `nal-${nalType}-payload-${sanitizedFieldName}-${index}`; // Use index for uniqueness

        // Determine if field should be read-only
        const isReadOnly = field.type === 'struct' || field.type === 'ue' || field.type === 'error' ||
                           field.type === 'data' || field.type === 'complex' || field.type === 'info' ||
                           field.type === 'bits' || // Treat generic 'bits' as read-only
                           field.name === "vps_reserved_0xffff_16bits" || // Treat reserved as read-only
                           field.name === "vps_reserved_three_2bits" || // Treat reserved as read-only
                           field.value === "..." || // Placeholders are read-only
                           field.error || // Explicit error case
                           !['u', 'f'].includes(field.type) || // Only allow editing known simple types for now
                           ![32, 33, 34, 35].includes(nalType); // Only allow editing in VPS/SPS/PPS/AUD for now (and only specific fields)

        // Use field.dataValue if present (like for AUD pic_type), otherwise use field.value
        const originalValue = field.hasOwnProperty('dataValue') ? field.dataValue : field.value;
        const displayValue = field.value; // Display value might include text like "(I)"
        const titleValue = field.comment ? ` title="${field.comment}"` : ''; // Add comment as tooltip

        fieldDiv.innerHTML = `
            <label for="${inputId}"${titleValue}>${nalName} - ${field.name}:</label>
            <input type="text" id="${inputId}" data-nal-type="${nalType}" data-field-name="${field.name}" data-field-index="${index}" data-original-value="${originalValue}" data-field-type="${field.type}" data-field-bits="${field.bits || ''}" value="${displayValue}" ${isReadOnly ? 'readonly style="background-color:#eee;"' : ''}>
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

    // Create a copy to modify
    // IMPORTANT: This implementation DOES NOT handle size changes (e.g. from EPB insertion/deletion).
    const modifiedBuffer = new ArrayBuffer(originalData.length);
    const modifiedData = new Uint8Array(modifiedBuffer);
    modifiedData.set(originalData);

    let modified = false; // Flag to track if any changes were made

    // --- VERY IMPORTANT CAVEATS ---
    // 1. Re-finds NAL units assuming structure (locations/lengths) hasn't changed. Only safe
    //    if modifications don't change NAL unit size (e.g., editing fixed-length fields,
    //    not Exp-Golomb or fields requiring EPB changes).
    // 2. Uses SAME simplified logic as `extractFields`. Cannot modify fields after variable-length structures.
    // 3. Does *not* handle RBSP emulation prevention bytes (0x03). Modifying data might break EPB requirements.
    // 4. Only integer modification of allowed 'u'/'f' fields is supported.
    // --- ---

    let nalStart = -1; // Start position of the NAL unit payload (byte after start code)
    let zeroCount = 0;
    let nalUnitIndex = 0; // Track NAL units processed (Still fragile for matching UI)

    for (let i = 0; i < originalData.length; i++) {
        if (zeroCount >= 2 && originalData[i] === 1) {
            const startCodeLen = zeroCount === 2 ? 3 : 4;
            const currentNalUnitDataStart = i + 1; // Position *after* the start code

            if (nalStart !== -1) {
                // Process the *previous* NAL unit found
                const nalUnitPayloadOffset = nalStart; // Offset where previous NAL payload starts
                const nalUnitPayloadEndOffset = i - startCodeLen; // End offset of previous NAL payload
                const nalUnitPayloadLength = nalUnitPayloadEndOffset - nalUnitPayloadOffset;

                if (nalUnitPayloadLength >= 2) { // Need at least header
                    // Apply modifications to the NAL unit payload
                    if (applyModificationsToNalPayload(modifiedData, nalUnitPayloadOffset, nalUnitPayloadLength, nalUnitIndex)) {
                        modified = true;
                    }
                    nalUnitIndex++;
                } else if (nalUnitPayloadLength >= 0) {
                    // Skip modification attempt for empty or header-only NALs
                    if (nalUnitPayloadLength >= 0) nalUnitIndex++; // Still increment index
                }
            }
            // Start of the *payload* of the new NAL unit
            nalStart = currentNalUnitDataStart;
            zeroCount = 0;
        } else if (originalData[i] === 0) {
            zeroCount++;
        } else {
            zeroCount = 0;
        }
    }

    // Process the last NAL unit
    if (nalStart !== -1 && nalStart < originalData.length) {
         const lastNalUnitPayloadOffset = nalStart;
         const lastNalUnitPayloadLength = originalData.length - lastNalUnitPayloadOffset;
         if (lastNalUnitPayloadLength >= 2) {
             if (applyModificationsToNalPayload(modifiedData, lastNalUnitPayloadOffset, lastNalUnitPayloadLength, nalUnitIndex)) {
                 modified = true;
             }
         }
    }


    return modified ? modifiedData : originalData; // Return modified only if changes were applied
}

// Helper function to apply modifications to a single NAL unit payload
function applyModificationsToNalPayload(modifiedData, nalUnitPayloadOffset, nalUnitPayloadLength, nalUnitIndex) {
    if (nalUnitPayloadLength < 2) return false; // Need header

    let changed = false;
    const headerByte1 = modifiedData[nalUnitPayloadOffset];
    // Extract NAL type
    const nalType = (headerByte1 & 0x7E) >> 1;
    // Offset of RBSP data within the modifiedData buffer
    const rbspOffset = nalUnitPayloadOffset + 2;
    // Length of the RBSP data
    const rbspLength = nalUnitPayloadLength - 2;

    if (rbspLength < 0) {
         console.warn(`NAL Unit type ${nalType} at offset ${nalUnitPayloadOffset} has invalid RBSP length (${rbspLength}). Skipping modification.`);
         return false;
    }

    // Find corresponding input fields for this NAL type *payload* in the DOM
    // WARNING: Assumes DOM order matches NAL unit order found here - FRAGILE.
    // Does not use nalUnitIndex robustly yet. Modifying a field in UI will attempt
    // to modify it in *all* NALs of that type found by this loop.
    const potentialInputs = document.querySelectorAll(`#fieldsContainer input[data-nal-type="${nalType}"][id^="nal-${nalType}-payload-"]`);

    potentialInputs.forEach(input => {
        // TODO: Add robust mapping logic if needed based on nalUnitIndex

        const fieldName = input.dataset.fieldName;
        const originalValueStr = input.dataset.originalValue; // Value originally extracted/set
        const currentValueStr = input.value; // Current value in the input box
        const fieldType = input.dataset.fieldType;
        const fieldBits = parseInt(input.dataset.fieldBits, 10) || 0;

        // Only proceed if value changed AND is not read-only/placeholder/error/etc.
        if (currentValueStr === originalValueStr || input.readOnly || originalValueStr === "..." || !fieldName || fieldName.includes("ERROR") || fieldName.includes("Note") || fieldName.includes("...") || !['u', 'f'].includes(fieldType) || fieldName.includes("reserved") /* Don't modify reserved fields */) {
            return; // Skip non-modifiable fields, unchanged values, or reserved fields
        }

        // Attempt to parse the new value (currently just integer)
        let newValue;
        if (fieldType === 'u' || fieldType === 'f') {
             newValue = parseInt(currentValueStr, 10);
             if (isNaN(newValue)) {
                 console.warn(`Invalid integer input "${currentValueStr}" for ${fieldName} (NAL Type ${nalType}). Skipping modification.`);
                 input.value = originalValueStr; // Revert UI
                 return;
             }
        } else {
             console.warn(`Modification logic for field type '${fieldType}' not implemented (${fieldName}). Skipping.`);
             input.value = originalValueStr; // Revert UI
             return;
        }


        // --- Simplified Modification Logic (Matches extraction limitations) ---
        // --- WARNING: HIGH RISK OF CORRUPTION ---
        // --- WARNING: NO RBSP ANTI-EMULATION ---
        // --- WARNING: CANNOT modify fields after variable-length structures ---
        try {
            let fieldModified = false;
            // Basic RBSP length check
             if (rbspLength < 1 && fieldName !== "ERROR" && fieldName !== "Note" ) {
                 console.warn(`RBSP too short (${rbspLength} bytes) to modify field ${fieldName} in NAL ${nalType}. Skipping.`);
                 input.value = originalValueStr; // Revert UI
                 return;
             }

            // --- VPS Modification Logic (nalType 32) ---
            if (nalType === 32) {
                // Calculate byte/bit offsets within RBSP based *only* on simplified field order
                if (fieldName === "vps_video_parameter_set_id") { // u(4) @ rbsp byte 0, bits 7-4
                    if (newValue >= 0 && newValue <= 15) {
                        modifiedData[rbspOffset] = (newValue << 4) | (modifiedData[rbspOffset] & 0x0F);
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-15).`); input.value = originalValueStr; }
                }
                // Note: vps_reserved_three_2bits f(2) @ byte 0, bits 3-2 (Skipped by filter above)
                else if (fieldName === "vps_max_layers_minus1") { // u(6) @ byte 0 bits 1-0, byte 1 bits 7-4
                     if (rbspLength >= 2 && newValue >= 0 && newValue <= 63) {
                         const val_byte0_bits = (newValue >> 4) & 0x03; // Upper 2 bits -> lower 2 bits of byte 0
                         const val_byte1_bits = (newValue & 0x0F) << 4; // Lower 4 bits -> upper 4 bits of byte 1
                         modifiedData[rbspOffset]     = (modifiedData[rbspOffset] & 0xFC) | val_byte0_bits;
                         modifiedData[rbspOffset + 1] = (modifiedData[rbspOffset + 1] & 0x0F) | val_byte1_bits;
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} (0-63) or RBSP too short (${rbspLength}<2) for ${fieldName}.`); input.value = originalValueStr; }
                } else if (fieldName === "vps_max_sub_layers_minus1") { // u(3) @ byte 1, bits 3-1
                    if (rbspLength >= 2 && newValue >= 0 && newValue <= 7) {
                        modifiedData[rbspOffset + 1] = (modifiedData[rbspOffset + 1] & 0xF1) | ((newValue & 0x07) << 1); // Mask: 1111 0001
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} (0-7) or RBSP too short (${rbspLength}<2) for ${fieldName}.`); input.value = originalValueStr; }
                } else if (fieldName === "vps_temporal_id_nesting_flag") { // u(1) @ byte 1, bit 0
                    if (rbspLength >= 2 && (newValue === 0 || newValue === 1)) {
                        modifiedData[rbspOffset + 1] = (modifiedData[rbspOffset + 1] & 0xFE) | (newValue & 0x01); // Mask: 1111 1110
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} (0-1) or RBSP too short (${rbspLength}<2) for ${fieldName}.`); input.value = originalValueStr; }
                }
                // Note: vps_reserved_0xffff_16bits @ bytes 2,3 (Skipped by filter)
                // Cannot modify fields after profile_tier_level (e.g. vps_sub_layer_ordering_info_present_flag, vps_max_layer_id, layer_id_included_flag placeholders etc.)
                // The placeholders like "vps_extension()" or "layer_id_included_flag" won't match here.
            }
            // --- SPS Modification Logic (nalType 33) ---
            else if (nalType === 33) {
                 if (fieldName === "sps_video_parameter_set_id") { // u(4) @ rbsp byte 0, bits 7-4
                    if (newValue >= 0 && newValue <= 15) {
                        modifiedData[rbspOffset] = (newValue << 4) | (modifiedData[rbspOffset] & 0x0F);
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-15).`); input.value = originalValueStr; }
                } else if (fieldName === "sps_max_sub_layers_minus1") { // u(3) @ rbsp byte 0, bits 3-1
                     if (newValue >= 0 && newValue <= 7) {
                         modifiedData[rbspOffset] = (modifiedData[rbspOffset] & 0xF1) | ((newValue & 0x07) << 1); // Mask: 1111 0001
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-7).`); input.value = originalValueStr; }
                } else if (fieldName === "sps_temporal_id_nesting_flag") { // u(1) @ rbsp byte 0, bit 0
                    if (newValue === 0 || newValue === 1) {
                        modifiedData[rbspOffset] = (modifiedData[rbspOffset] & 0xFE) | (newValue & 0x01); // Mask: 1111 1110
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-1).`); input.value = originalValueStr; }
                }
                 // Other SPS fields (profile_tier_level, ue(v)) not modifiable here
            }
            // --- PPS Modification Logic (nalType 34) ---
            // (No simple fields implemented here for modification)

            // --- AUD Modification Logic (nalType 35) ---
            else if (nalType === 35) {
                if (fieldName === "pic_type") { // u(3) @ rbsp byte 0, bits 7-5
                    // Use the numeric originalValueStr for validation/modification
                    if (newValue >= 0 && newValue <= 7) {
                        modifiedData[rbspOffset] = (newValue << 5) | (modifiedData[rbspOffset] & 0x1F); // Mask: 0001 1111
                        fieldModified = true;
                         // Update the display value in the input field
                         const picTypeMap = { 0: 'I', 1: 'P, I', 2: 'B, P, I', 3: 'SI', 4: 'SP, SI', 5: 'P, I, SP, SI', 6: 'B, P, I, SP, SI', 7: 'B, P, I, SP, SI'};
                         input.value = `${newValue} (${picTypeMap[newValue] || 'Unknown'})`;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-7).`); /* Revert handled below if !fieldModified */ }
                }
            }

            // --- Update state if modification occurred ---
            if (fieldModified) {
                console.log(`Modified NAL ${nalType} (offset ${nalUnitPayloadOffset}) field "${fieldName}" from ${originalValueStr} to ${newValue}`);
                // Update input's original value dataset to the *new numeric value*
                // This prevents re-applying the same change and allows further edits.
                input.dataset.originalValue = newValue.toString();
                changed = true; // Mark that *some* change happened in this NAL unit
            } else if (!input.readOnly && originalValueStr !== "...") {
                // If modification wasn't handled/failed validation, revert input field
                 if (!fieldName.includes("ERROR") && !fieldName.includes("Note") && !fieldName.includes("...") && fieldType !== 'struct' && fieldType !== 'ue' && fieldType !== 'complex' && fieldType !== 'bits') {
                     // Only warn/revert for fields we *might* have expected to modify
                     console.warn(`Modification not implemented or failed validation for NAL ${nalType}, field "${fieldName}". Reverting input.`);
                     // Revert display value based on original numeric value for AUD
                     if(nalType === 35 && fieldName === "pic_type") {
                          const picTypeMap = { 0: 'I', 1: 'P, I', 2: 'B, P, I', 3: 'SI', 4: 'SP, SI', 5: 'P, I, SP, SI', 6: 'B, P, I, SP, SI', 7: 'B, P, I, SP, SI'};
                          const origNumVal = parseInt(originalValueStr, 10); // Parse original numeric value
                          if (!isNaN(origNumVal)) {
                              input.value = `${origNumVal} (${picTypeMap[origNumVal] || 'Unknown'})`;
                          } else { input.value = originalValueStr; } // Fallback
                     } else {
                         input.value = originalValueStr; // Revert simple text display
                     }
                 }
            }

        } catch (e) {
            console.error(`Error applying modification for NAL ${nalType}, field ${fieldName}:`, e);
            // Revert input on error - handle AUD special display case
             if(nalType === 35 && fieldName === "pic_type") {
                  const picTypeMap = { 0: 'I', 1: 'P, I', 2: 'B, P, I', 3: 'SI', 4: 'SP, SI', 5: 'P, I, SP, SI', 6: 'B, P, I, SP, SI', 7: 'B, P, I, SP, SI'};
                  const origNumVal = parseInt(originalValueStr, 10); // Parse original numeric value
                  if (!isNaN(origNumVal)) {
                      input.value = `${origNumVal} (${picTypeMap[origNumVal] || 'Unknown'})`;
                  } else { input.value = originalValueStr; } // Fallback
             } else {
                 input.value = originalValueStr; // Revert simple text display
             }
        }
    });

    return changed; // Return true if any field within this NAL unit was successfully changed
}

// --- Helper Functions (Not fully used/implemented) ---

// function removeEmulationPrevention(rbspData) {
//     // Simple implementation - may not be fully robust or efficient
//     const output = [];
//     for (let i = 0; i < rbspData.length; i++) {
//         if (i + 2 < rbspData.length && rbspData[i] === 0x00 && rbspData[i + 1] === 0x00 && rbspData[i + 2] === 0x03) {
//             output.push(0x00);
//             output.push(0x00);
//             i += 2; // Skip the 0x03 byte
//         } else {
//             output.push(rbspData[i]);
//         }
//     }
//     return new Uint8Array(output);
// }

// class BitReader {
//     constructor(uint8Array) { // Assumes EPB are already removed
//         this.data = uint8Array;
//         this.bytePos = 0;
//         this.bitPos = 0; // 0-7 (MSB to LSB)
//         this.endOfData = false;
//     }
//     readBits(n) { /* ... implementation ... */ }
//     readU(n) { /* ... */ }
//     readF(n) { /* ... */ }
//     readUE() { /* ... Exp-Golomb u*/ }
//     readSE() { /* ... Exp-Golomb s*/ }
//     // TODO: Handle RBSP stop bit and trailing bits
// }
