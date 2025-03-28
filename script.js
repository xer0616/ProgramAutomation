
const version = 7
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
    // nuh_layer_id: u(6) (bit 0 of byte 0 combined with bits 7-3 of byte 1) - Incorrect in original, fixed below
    const nuhLayerId = headerByte2 >> 3; // Correct extraction: Uses bits 7-3 of byte 1 only
    // nuh_temporal_id_plus1: u(3) (bits 2-0 of byte 1)
    const nuhTemporalIdPlus1 = headerByte2 & 0x07;


    const nalName = getNALName(nalType);

    if (forbiddenZeroBit !== 0) {
        console.warn(`Forbidden zero bit is not zero (${forbiddenZeroBit}) for NAL Unit ${nalName} (${nalType}).`);
    }
    if (nuhTemporalIdPlus1 === 0) {
        // Note: TemporalIdPlus1 being 0 is *valid* according to the spec (temporal_id = 0).
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
        // 24-31 Reserved non-IRAP VCL -> RSV_NVCL as per Table 7-1
        32: "VPS_NUT",        // Video Parameter Set
        33: "SPS_NUT",        // Sequence Parameter Set
        34: "PPS_NUT",        // Picture Parameter Set
        35: "AUD_NUT",        // Access Unit Delimiter
        36: "EOS_NUT",        // End of Sequence
        37: "EOB_NUT",        // End of Bitstream
        38: "FD_NUT",         // Filler Data
        39: "PREFIX_SEI_NUT", // Supplemental enhancement information (SEI) prefix
        40: "SUFFIX_SEI_NUT", // Supplemental enhancement information (SEI) suffix
        // 41-47 Reserved non-VCL -> RSV_NVCL as per Table 7-1
        // 48-63 Unspecified
    };
    if (nalType >= 24 && nalType <= 31) return `RSV_NVCL (${nalType})`; // Corrected name for this range
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
    // The bit offsets calculated here are only valid *if* no emulation prevention bytes
    // appear before the field and *if* preceding variable-length fields are ignored.
    // --- ---
    let fields = [];
    let currentBitOffset = 0; // Track bits for more complex future parsing (not fully used yet)

    // Use a BitReader helper for potentially more robust parsing in the future (though not fully utilized here yet)
    // For now, direct byte access is still used for simplicity, matching the previous logic.
    // const bitReader = new BitReader(payloadData);

    if (payloadData.length < 1 && ![36, 37].includes(nalType) /* EOS/EOB can be empty */) {
       // console.warn(`NAL unit payload potentially too short for NAL Type ${nalType}.`);
       // Allow processing to continue for empty NALs like EOS/EOB
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
            // The profile_tier_level structure follows here. Its size is variable
            // depending on vps_max_sub_layers_minus1.
            // The current code does NOT parse profile_tier_level.
            // Therefore, the *exact* bit offset of subsequent fields cannot be determined reliably.
            // We will add vps_sub_layer_ordering_info_present_flag as a placeholder.
            // --- ---

            // Placeholder for the complex profile_tier_level structure
            fields.push({ name: "profile_tier_level(...)", value: "...", type: 'struct', comment: `Complex structure. Size depends on vps_max_sub_layers_minus1 (${vps_max_sub_layers_minus1}). Parsing not implemented.` });
            // **Approximate** currentByteOffset assuming profile_tier_level exists (at least 12 bytes)
            // This is NOT accurate for calculation but helps conceptualize.
            // currentBitOffset += 96; // Minimum size for profile_tier_level

            // vps_sub_layer_ordering_info_present_flag: u(1)
            // This flag comes *after* profile_tier_level. Since we don't parse profile_tier_level,
            // we cannot extract its actual value using fixed offsets. Add as placeholder.
            fields.push({
                name: "vps_sub_layer_ordering_info_present_flag",
                value: "...", // Placeholder - cannot determine offset accurately
                bits: 1,
                type: 'u',
                comment: "Position depends on variable size of profile_tier_level structure. Parsing not implemented."
            });
            currentBitOffset += 1; // Increment conceptually

            // Additional logic would be needed here to parse the loop based on vps_sub_layer_ordering_info_present_flag
            // and vps_max_sub_layers_minus1 if we could determine the starting offset.
            // Example placeholders for what *might* follow:
             fields.push({ name: "vps_max_dec_pic_buffering_minus1[...]", value: "...", type: 'ue[]', comment: "Requires parsing loop based on preceding flag/values" });
             fields.push({ name: "vps_max_num_reorder_pics[...]", value: "...", type: 'ue[]', comment: "Requires parsing loop" });
             fields.push({ name: "vps_max_latency_increase_plus1[...]", value: "...", type: 'ue[]', comment: "Requires parsing loop" });


             // Placeholder for remaining data/extensions
             fields.push({ name: "vps_remaining_data/extensions", value: "...", type: 'data', comment: "Further fields like vps_max_layer_id, vps_num_layer_sets_minus1, timing_info, extensions etc. require full parsing." });


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
            if (payloadData.length > 1) { // Indicate more data exists
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
            // This is a highly simplified placeholder
             fields.push({ name: "SEI Message(s)", value: "...", type: 'complex', comment: "Requires full SEI message parsing (type, size, payload loops)" });
             if (payloadData.length > 0) {
                  fields.push({ name: "sei_data_preview", value: `[${payloadData.slice(0, Math.min(8, payloadData.length)).map(b => b.toString(16).padStart(2,'0')).join(' ')}...]`, type: 'data' });
             }
        }
        // Add extraction logic for other NAL types if needed (e.g., FD_NUT)
        // Note: EOS_NUT (36), EOB_NUT (37) have no syntax elements in their RBSP.
        else if (nalType === 36 || nalType === 37) {
             // No fields to extract, but presence is meaningful
             fields.push({ name: "Note", value: "No payload fields defined", type: 'info' });
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

        // Use a unique identifier
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
        // Sanitize name for ID: replace non-alphanumeric with underscore
        const sanitizedFieldName = field.name.replace(/\W/g, '_');
        // Append 'payload' to avoid ID collision with potential header fields of the same name
        const inputId = `nal-${nalType}-payload-${sanitizedFieldName}-${index}`; // Use index for uniqueness

        // Determine if field should be read-only
        const isReadOnly = field.type === 'struct' || field.type === 'ue' || field.type === 'error' ||
                           field.type === 'data' || field.type === 'complex' || field.type === 'info' ||
                           field.name === "vps_reserved_0xffff_16bits" || // Treat reserved as read-only
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
    //    It CANNOT modify fields that follow variable-length structures (like profile_tier_level).
    // 3. This does *not* handle RBSP emulation prevention bytes (0x000003 -> 0x0000 and back).
    //    Modifying data might require adding/removing these bytes, which changes NAL unit size.
    // 4. Only integer modification is supported for simplicity for 'u' type fields.
    // --- ---

    let nalStartByteOffset = -1; // Offset in the *originalData* / *modifiedData* array where the NAL unit *payload* starts
    let nalUnitStartCodeLen = 0; // Length of the start code for the current NAL unit
    let zeroCount = 0;
    let nalUnitIndex = 0; // Keep track of NAL units processed (Still fragile for matching UI)

    for (let i = 0; i < originalData.length; i++) {
        if (zeroCount >= 2 && originalData[i] === 1) {
            const currentStartCodeLen = zeroCount === 2 ? 3 : 4;
            // Offset where the NAL unit *data* (including header) starts in originalData
            const currentNalUnitStartOffset = i - currentStartCodeLen + 1;

            if (nalStartByteOffset !== -1) {
                // Process the *previous* NAL unit found
                // Calculate start of NAL header in originalData
                const nalHeaderOffset = nalStartByteOffset - nalUnitStartCodeLen;
                // NAL unit length includes the 2-byte header
                const nalUnitLength = (currentNalUnitStartOffset - nalHeaderOffset);

                // Apply modifications to the NAL unit located at nalHeaderOffset with length nalUnitLength
                if (applyModificationsToNal(modifiedData, nalHeaderOffset, nalUnitLength, nalUnitIndex)) {
                    modified = true;
                }
                nalUnitIndex++;
            }
            // Start of the *payload* of the new NAL unit (immediately after the start code)
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
         // Calculate start of NAL header for the last unit
         const nalHeaderOffset = nalStartByteOffset - nalUnitStartCodeLen;
         // Length is from the header start to the end of the data
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
    // Offset of payload (RBSP data) within the modifiedData buffer
    const payloadOffset = nalUnitOffset + 2;
    // Length of the payload data
    const payloadLength = nalUnitLength - 2;

    if (payloadLength < 0) {
         console.warn(`NAL Unit type ${nalType} at offset ${nalUnitOffset} has invalid payload length (${payloadLength}). Skipping modification.`);
         return false;
    }

    // Find corresponding input fields for this NAL type *payload* in the DOM
    // This still assumes the order matches the DOM order, which is fragile.
    // A better system would store NAL unit metadata with the input elements.
    const potentialInputs = document.querySelectorAll(`#fieldsContainer input[data-nal-type="${nalType}"][id^="nal-${nalType}-payload-"]`);

    // Rough check if these inputs belong to the current nalUnitIndex (extremely fragile assumption)
    // For now, apply changes to all matching fields found. If multiple NALs of the
    // same type exist, changing one UI field will attempt to change it in all of them.
    // This part needs a more robust mapping between NAL units and UI elements for complex streams.

    potentialInputs.forEach(input => {
        // TODO: Add robust mapping logic if needed based on nalUnitIndex

        const fieldName = input.dataset.fieldName;
        const originalValueStr = input.dataset.originalValue; // Value originally extracted or previously set
        const currentValueStr = input.value; // Current value in the input box
        const fieldType = input.dataset.fieldType;
        const fieldBits = parseInt(input.dataset.fieldBits, 10) || 0;

        // Only proceed if the value has actually changed from the original/previous dataset value
        // AND is not read-only/placeholder/error/etc.
        if (currentValueStr === originalValueStr || input.readOnly || originalValueStr === "..." || !fieldName || fieldName.includes("ERROR") || fieldName.includes("Note") || fieldName.includes("...") || !['u', 'f'].includes(fieldType)) {
            return; // Skip non-modifiable fields or unchanged values
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
             // This case should technically be already filtered out, but as safety:
             console.warn(`Modification logic for field type '${fieldType}' not implemented (${fieldName}). Skipping.`);
             input.value = originalValueStr; // Revert UI
             return;
        }


        // --- Simplified Modification Logic (Matches extraction limitations) ---
        // --- WARNING: HIGH RISK OF CORRUPTION IF MODIFYING INCORRECTLY ---
        // --- WARNING: DOES NOT HANDLE RBSP ANTI-EMULATION ---
        // --- WARNING: Modifying one field might affect others if bits overlap or bytes are shared ---
        // --- WARNING: CANNOT modify fields after variable-length structures (e.g., profile_tier_level) ---
        try {
            let fieldModified = false;
            // Check payload length before accessing bytes for the specific field
            // (Basic check, doesn't account for complex offsets)
             if (payloadLength < 1 && fieldName !== "ERROR" /* Allow processing error fields conceptually*/) {
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
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-15).`); input.value = originalValueStr; }
                } else if (fieldName === "vps_base_layer_internal_flag") { // u(1) @ byte 0, bit 3
                    if (newValue === 0 || newValue === 1) {
                        modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 3)) | ((newValue & 0x01) << 3);
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-1).`); input.value = originalValueStr; }
                } else if (fieldName === "vps_base_layer_available_flag") { // u(1) @ byte 0, bit 2
                     if (newValue === 0 || newValue === 1) {
                         modifiedData[payloadOffset] = (modifiedData[payloadOffset] & ~(1 << 2)) | ((newValue & 0x01) << 2);
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-1).`); input.value = originalValueStr; }
                } else if (fieldName === "vps_max_layers_minus1") { // u(6) @ byte 0 bits 1-0, byte 1 bits 7-4
                     if (payloadLength >= 2 && newValue >= 0 && newValue <= 63) {
                         const val_byte0_bits = (newValue >> 4) & 0x03; // Upper 2 bits of value -> lower 2 bits of byte 0
                         const val_byte1_bits = (newValue & 0x0F) << 4; // Lower 4 bits of value -> upper 4 bits of byte 1
                         modifiedData[payloadOffset]     = (modifiedData[payloadOffset] & 0xFC) | val_byte0_bits;
                         modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0x0F) | val_byte1_bits;
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} (0-63) or payload too short (${payloadLength}<2) for ${fieldName}.`); input.value = originalValueStr; }
                } else if (fieldName === "vps_max_sub_layers_minus1") { // u(3) @ byte 1, bits 3-1
                    if (payloadLength >= 2 && newValue >= 0 && newValue <= 7) {
                        modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xF1) | ((newValue & 0x07) << 1); // Mask: 1111 0001
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} (0-7) or payload too short (${payloadLength}<2) for ${fieldName}.`); input.value = originalValueStr; }
                } else if (fieldName === "vps_temporal_id_nesting_flag") { // u(1) @ byte 1, bit 0
                    if (payloadLength >= 2 && (newValue === 0 || newValue === 1)) {
                        modifiedData[payloadOffset + 1] = (modifiedData[payloadOffset + 1] & 0xFE) | (newValue & 0x01); // Mask: 1111 1110
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} (0-1) or payload too short (${payloadLength}<2) for ${fieldName}.`); input.value = originalValueStr; }
                }
                // Cannot modify vps_sub_layer_ordering_info_present_flag or subsequent fields due to profile_tier_level offset issue.
                else if (fieldName === "vps_sub_layer_ordering_info_present_flag") {
                    console.warn(`Modification of ${fieldName} is not supported due to unknown offset after profile_tier_level.`);
                    input.value = originalValueStr; // Revert UI
                }
                // Note: vps_reserved_0xffff_16bits is read-only by design here
            }
            // --- SPS Modification Logic (nalType 33) ---
            else if (nalType === 33) {
                 if (fieldName === "sps_video_parameter_set_id") { // u(4) @ byte 0, bits 7-4
                    if (newValue >= 0 && newValue <= 15) {
                        modifiedData[payloadOffset] = (newValue << 4) | (modifiedData[payloadOffset] & 0x0F);
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-15).`); input.value = originalValueStr; }
                } else if (fieldName === "sps_max_sub_layers_minus1") { // u(3) @ byte 0, bits 3-1
                     if (newValue >= 0 && newValue <= 7) {
                         modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xF1) | ((newValue & 0x07) << 1); // Mask: 1111 0001
                         fieldModified = true;
                     } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-7).`); input.value = originalValueStr; }
                } else if (fieldName === "sps_temporal_id_nesting_flag") { // u(1) @ byte 0, bit 0
                    if (newValue === 0 || newValue === 1) {
                        modifiedData[payloadOffset] = (modifiedData[payloadOffset] & 0xFE) | (newValue & 0x01); // Mask: 1111 1110
                        fieldModified = true;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-1).`); input.value = originalValueStr; }
                }
                 // Other SPS fields are complex (profile_tier_level, ue(v)) and not modifiable here
            }
            // --- PPS Modification Logic (nalType 34) ---
            // (No simple fields implemented here yet for modification - all start with ue(v))

            // --- AUD Modification Logic (nalType 35) ---
            else if (nalType === 35) {
                if (fieldName === "pic_type") { // u(3) @ byte 0, bits 7-5
                    // Use the numeric originalValueStr for validation/modification
                    if (newValue >= 0 && newValue <= 7) {
                        modifiedData[payloadOffset] = (newValue << 5) | (modifiedData[payloadOffset] & 0x1F); // Mask: 0001 1111
                        fieldModified = true;
                         // Update the display value in the input field to match the new numeric value + description
                         const picTypeMap = { 0: 'I', 1: 'P, I', 2: 'B, P, I', 3: 'SI', 4: 'SP, SI', 5: 'P, I, SP, SI', 6: 'B, P, I, SP, SI', 7: 'B, P, I, SP, SI'};
                         input.value = `${newValue} (${picTypeMap[newValue] || 'Unknown'})`;
                    } else { console.warn(`Invalid value ${newValue} for ${fieldName} (0-7).`); input.value = originalValueStr; } // Revert UI display if invalid
                }
            }

            // --- Update state if modification occurred ---
            if (fieldModified) {
                console.log(`Modified NAL ${nalType} (offset ${nalUnitOffset}) field "${fieldName}" from ${originalValueStr} to ${newValue}`);
                // Update the input's original value dataset to the *new numeric value*
                // This prevents re-applying the same change and allows further edits from the new state.
                // For AUD, we store the numeric value.
                input.dataset.originalValue = newValue.toString();
                changed = true; // Mark that *some* change happened in this NAL unit
            } else if (!input.readOnly && originalValueStr !== "...") {
                // If modification wasn't handled (e.g., field not in the logic above) or failed validation, revert the input field
                 if (!fieldName.includes("ERROR") && !fieldName.includes("Note") && !fieldName.includes("...") && fieldType !== 'struct' && fieldType !== 'ue' && fieldType !== 'complex') {
                     // Only warn/revert for fields we *might* have expected to modify
                     console.warn(`Modification not implemented or failed validation for NAL ${nalType}, field "${fieldName}". Reverting input.`);
                     // Revert display value based on original numeric value for AUD
                     if(nalType === 35 && fieldName === "pic_type") {
                          const picTypeMap = { 0: 'I', 1: 'P, I', 2: 'B, P, I', 3: 'SI', 4: 'SP, SI', 5: 'P, I, SP, SI', 6: 'B, P, I, SP, SI', 7: 'B, P, I, SP, SI'};
                          input.value = `${originalValueStr} (${picTypeMap[parseInt(originalValueStr)] || 'Unknown'})`;
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
                  input.value = `${originalValueStr} (${picTypeMap[parseInt(originalValueStr)] || 'Unknown'})`;
             } else {
                 input.value = originalValueStr; // Revert simple text display
             }
        }
    });

    return changed; // Return true if any field within this NAL unit was successfully changed
}

// Basic Bit Reader Helper (Optional - not fully integrated but useful for future expansion)
// class BitReader {
//     constructor(uint8Array) {
//         this.data = uint8Array;
//         this.bytePos = 0;
//         this.bitPos = 0; // Position within the current byte (0-7, from MSB)
//     }

//     readBits(n) {
//         if (n > 32) throw new Error("Cannot read more than 32 bits at once");
//         let value = 0;
//         for (let i = 0; i < n; i++) {
//             if (this.bytePos >= this.data.length) {
//                 // console.warn("Attempted to read beyond buffer end");
//                 return null; // Indicate end of data
//             }
//             const byte = this.data[this.bytePos];
//             const bit = (byte >> (7 - this.bitPos)) & 1;
//             value = (value << 1) | bit;
//             this.bitPos++;
//             if (this.bitPos === 8) {
//                 this.bitPos = 0;
//                 this.bytePos++;
//             }
//         }
//         return value;
//     }
//      // TODO: Add methods for ue(v), se(v), f(n), etc.
//      // TODO: Handle RBSP stop bit and trailing bits (byte alignment)
//      // TODO: Handle emulation prevention bytes (0x000003 removal) - this is complex
// }
