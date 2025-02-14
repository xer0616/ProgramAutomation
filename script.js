
const version = 11
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
        34: "PPS"
    };
    return nalMap[nalType] || `NAL Type ${nalType}`;
}

function extractFields(nalType, data) {
    let fields = [];
    if (nalType === 32) {
        fields.push({ name: "vps_video_parameter_set_id", value: data[4] & 0x7F });
        fields.push({ name: "vps_max_layers_minus1", value: (data[5] >> 3) & 0x1F });
        fields.push({ name: "vps_max_sub_layers_minus1", value: data[5] & 0x07 });
        fields.push({ name: "vps_temporal_id_nesting_flag", value: (data[6] >> 7) & 0x01 });
    } else if (nalType === 33) {
        fields.push({ name: "sps_video_parameter_set_id", value: data[4] & 0x7F });
        fields.push({ name: "sps_seq_parameter_set_id", value: data[5] & 0x1F });
        fields.push({ name: "sps_chroma_format_idc", value: (data[6] >> 2) & 0x03 });
        fields.push({ name: "sps_max_sub_layers_minus1", value: data[6] & 0x07 });
        fields.push({ name: "sps_temporal_id_nesting_flag", value: (data[7] >> 7) & 0x01 });
        fields.push({ name: "sps_separate_colour_plane_flag", value: (data[7] >> 6) & 0x01 });
        fields.push({ name: "sps_pic_width_in_luma_samples", value: ((data[12] & 0x03) << 16) | ((data[13] & 0xFF) << 8) | data[14] });
        fields.push({ name: "sps_pic_height_in_luma_samples", value: ((data[15] & 0x03) << 16) | ((data[16] & 0xFF) << 8) | data[17] });
        fields.push({ name: "sps_conformance_window_flag", value: (data[11] >> 4) & 0x01 }); // Added conformance_window_flag field
        fields.push({ name: "sps_conf_win_left_offset", value: ((data[18] & 0x03) << 16) | ((data[19] & 0xFF) << 8) | data[20] }); // Added conf_win_left_offset field
        fields.push({ name: "sps_conf_win_right_offset", value: ((data[21] & 0x03) << 16) | ((data[22] & 0xFF) << 8) | data[23] }); // Added conf_win_right_offset field
        fields.push({ name: "sps_conf_win_top_offset", value: ((data[24] & 0x03) << 16) | ((data[25] & 0xFF) << 8) | data[26] }); // Added conf_win_top_offset field
        fields.push({ name: "sps_conf_win_bottom_offset", value: ((data[27] & 0x03) << 16) | ((data[28] & 0xFF) << 8) | data[29] }); // Added conf_win_bottom_offset field
    } else if (nalType === 34) {
        fields.push({ name: "pps_pic_parameter_set_id", value: data[5] & 0x3F });
        fields.push({ name: "pps_seq_parameter_set_id", value: data[6] & 0x1F });
        fields.push({ name: "pps_separate_colour_plane_flag", value: (data[6] >> 6) & 0x01 });
    }
    return fields;
}

function displayFields(nalName, fields) {
    const container = document.getElementById("fieldsContainer");
    fields.forEach(field => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";
        fieldDiv.innerHTML = `<label>${nalName} - ${field.name}:</label> <input type="text" value="${field.value}">`;
        container.appendChild(fieldDiv);
    });
}

document.getElementById("downloadBtn").addEventListener("click", function() {
    const modifiedData = modifyStream();
    const blob = new Blob([modifiedData], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "updated.h265";
    a.click();
});

function modifyStream() {
    return originalData || new Uint8Array([]);
}
