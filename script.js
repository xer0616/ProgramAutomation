
// Specify the H.265 (HEVC) version supported by the script
const version = 21
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
    for (let i = 0; i < data.length - 4; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
            let nalType = (data[i + 3] & 0x7E) >> 1;
            let nalName = getNALName(nalType);
            let fields = extractFields(nalType, data.subarray(i));
            displayFields(nalName, fields);
        }
    }
    document.getElementById("downloadBtn").disabled = false;
}

function getNALName(nalType) {
    const nalMap = {
        32: "VPS",
        33: "SPS",
        34: "PPS",
        48: "IDR"
    };
    return nalMap[nalType] || `NAL Type ${nalType}`;
}

function extractFields(nalType, data) {
    let fields = [];
    if (nalType === 32) {
        fields.push({ name: "vps_video_parameter_set_id", value: data[4] & 0x3F });
        fields.push({ name: "vps_reserved_three_2bits", value: (data[4] >> 6) & 0x03 });
        fields.push({ name: "vps_reserved_0xffff_16bits", value: data[5] + (data[6] << 8) });
        fields.push({ name: "vps_extension_flag", value: (data[7] >> 7) & 0x01 });
        fields.push({ name: "vps_max_layers_minus1", value: (data[8] >> 3) & 0x1F });
        fields.push({ name: "vps_max_sub_layers_minus1", value: data[8] & 0x07 });
        fields.push({ name: "vps_num_layer_sets_minus1", value: data[9] & 0x0F });
        fields.push({ name: "vps_timing_info_present_flag", value: (data[9] >> 7) & 0x01 });
        fields.push({ name: "vps_vps_time_scale", value: (data[9] >> 4) & 0x0F });
        fields.push({ name: "vps_max_dpb_size", value: (data[9] >> 0) & 0x0F });
        fields.push({ name: "vps_max_num_reorder_pics", value: (data[9] >> 0) & 0x0F });
        fields.push({ name: "vps_max_latency_increase_plus1", value: data[10] });
        fields.push({ name: "vps_poc_proportional_to_timing_flag", value: (data[11] >> 6) & 0x01 });
        fields.push({ name: "vps_max_layer_id", value: data[11] });
        fields.push({ name: "vps_layer_id_included_flag", value: (data[12] >> 7) & 0x01 });
        fields.push({ name: "vps_max_dec_pic_buffering_minus1", value: (data[12] + (data[13] << 8)) >> 1 });
        fields.push({ name: "vps_num_units_in_tick", value: data[14] });
        fields.push({ name: "vps_num_ticks_poc_diff_one_minus1", value: data[15] & 0x3F });
        fields.push({ name: "vps_num_hrd_parameters", value: data[15] >> 6 });
        for (let i = 0; i < data[15] >> 6; i++) {
            fields.push({ name: `vps_hrd_layer_set_idx[${i}]`, value: (data[16 + i * 2] >> 2) & 0x3F });
        }
        fields.push({ name: "vps_cprms_present_flag", value: (data[16 + (data[15] >> 6) * 2] >> 7) & 0x01 });
    } else if (nalType === 33) {
        fields.push({ name: "sps_video_parameter_set_id", value: (data[5] >> 7) & 0x1F });
        fields.push({ name: "sps_seq_parameter_set_id", value: data[5] & 0x1F });
        fields.push({ name: "sps_reserved_three_4bits", value: (data[5] >> 3) & 0x07 });
        fields.push({ name: "sps_max_sub_layers_minus1", value: (data[6] >> 5) & 0x07 });
        fields.push({ name: "sps_temporal_id_nesting_flag", value: (data[7] >> 3) & 0x01 });
        fields.push({ name: "sps_reserved_1bit", value: data[7] & 0x01 });
        fields.push({ name: "sps_chroma_format_idc", value: data[8] & 0x0F });
        fields.push({ name: "sps_pic_width_in_luma_samples", value: data[9] + (data[10] << 8) + (data[11] << 16) + (data[12] << 24) });
        fields.push({ name: "sps_pic_height_in_luma_samples", value: data[13] + (data[14] << 8) });
        fields.push({ name: "sps_poc_width_in_luma_samples", value: data[15] + (data[16] << 8) });
        fields.push({ name: "sps_conformance_window_flag", value: (data[17] >> 7) & 0x01 });
        fields.push({ name: "sps_separate_colour_plane_flag", value: (data[17] >> 6) & 0x01 });
        fields.push({ name: "sps_conf_win_left_offset", value: data[18] + (data[19] << 8) });
        fields.push({ name: "sps_conf_win_top_offset", value: data[20] + (data[21] << 8) });
        fields.push({ name: "sps_conf_win_right_offset", value: data[22] + (data[23] << 8) });
        fields.push({ name: "sps_conf_win_bottom_offset", value: data[24] + (data[25] << 8) });
        fields.push({ name: "sps_scaling_list_enable_flag", value: (data[26] >> 6) & 0x03 });
        fields.push({ name: "sps_scaling_list_data_present_flag", value: (data[26] >> 5) & 0x01 });
        fields.push({ name: "sps_amp_enabled_flag", value: (data[26] >> 4) & 0x01 });
        fields.push({ name: "sps_sample_adaptive_offset_enabled_flag", value: (data[26] >> 3) & 0x01 });
        fields.push({ name: "sps_pcm_enabled_flag", value: (data[27] >> 7) & 0x01 });
        fields.push({ name: "sps_pcm_sample_bit_depth_luma_minus1", value: (data[27] >>