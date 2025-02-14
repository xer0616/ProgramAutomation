
// Specify the H.265 (HEVC) version supported by the script
const version = 36
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
        fields.push({ name: "sps_video_parameter_set_id", value: data[4] & 0x3F });
        fields.push({ name: "sps_seq_parameter_set_id", value: data[5] & 0x1F });
        fields.push({ name: "sps_chroma_format_idc", value: (data[6] >> 4) & 0x0F });
        fields.push({ name: "sps_bit_depth_luma_minus8", value: data[7] & 0x0F });
        fields.push({ name: "sps_bit_depth_chroma_minus8", value: (data[8] >> 4) & 0x0F });
        fields.push({ name: "sps_log2_max_pic_order_cnt_lsb_minus4", value: (data[8] >> 0) & 0x0F });
        fields.push({ name: "sps_sps_max_minus1_sub_layer_deltas_present_flag", value: (data[9] >> 7) & 0x01 });
        fields.push({ name: "sps_sps_max_sub_layers_minus1", value: (data[9] >> 5) & 0x07 });
        fields.push({ name: "sps_spc_sbtmvp_flag", value: (data[9] >> 4) & 0x01 });
        fields.push({ name: "sps_sps_sbt_mvp_skip_flag", value: (data[9] >> 3) & 0x01 });
        fields.push({ name: "sps_sps_temporal_mvp_enable_flag", value: (data[9] >> 2) & 0x01 });
        fields.push({ name: "sps_sps_strong_intra_smoothing_enable_flag", value: (data[9] >> 1) & 0x01 });
        fields.push({ name: "sps_vui_parameters_present_flag", value: data[9] & 0x01 });
    } else if (nalType === 34) {
        fields.push({ name: "pps_pic_parameter_set_id", value: data[4] & 0x3F });
        fields.push({ name: "pps_seq_parameter_set_id", value: data[6] & 0x1F });
        fields.push({ name: "pps_dependent_slice_segments_enabled_flag", value: (data[7] >> 7) & 0x01 });
        fields.push({ name: "pps_output_flag_present_flag", value: (data[7] >> 6) & 0x01 });
        fields.push({ name: "pps_num_extra_slice_header_bits", value: data[7] & 0x1F });
        fields.push({ name: "pps_sign_data_hiding_enabled_flag", value: (data[8] >> 7) & 0x01 });
        fields.push({ name: "pps_cabac_init_present_flag", value: (data[8] >> 6) & 0x01 });
        fields.push({ name: "pps_num_reorder_pics", value: (data[8] >> 0) & 0x3F });
        fields.push({ name: "pps_max_num_reorder_pics", value: data[9] });
        fields.push({ name: "pps_max_dec_pic