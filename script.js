// Specify the H.265 (HEVC) version supported by the script
const version = 29
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
        fields.push({ name: "vps_max_layers_minus1", value: (data[8] >> 3) & 0x1F });
        fields.push({ name: "vps_max_sub_layers_minus1", value: data[8] & 0x07 });
        fields.push({ name: "vps_num_layer_sets_minus1", value: data[9] & 0x0F });
        fields.push({ name: "vps_timing_info_present_flag", value: (data[9] >> 7) & 0x01 });
        fields.push({ name: "vps_vps_time_scale", value: (data[9] >> 4) & 0x0F });
        fields.push({ name: "vps_max_dpb_size", value: (data[9] >> 0) & 0x0F });
        fields.push({ name: "vps_max_num_reorder_pics", value: (data[9] >> 0) & 0x0F });
        fields.push({ name: "vps_max_latency_increase_plus1", value: data[10] });
        fields.push({ name: "vps_max_layer_id", value: data[11] });
        fields.push({ name: "vps_layer_id_included_flag", value: (data[12] >> 7) & 0x01 });
        fields.push({ name: "vps_max_dec_pic_buffering_minus1", value: (data[12] + (data[13] << 8)) >> 1 });
        fields.push({ name: "vps_num_units_in_tick", value: data[14] });
    } else if (nalType === 33) {
        fields.push({ name: "sps_seq_parameter_set_id", value: data[5] & 0x1F });
        fields.push({ name: "sps_max_sub_layers_minus1", value: (data[6] >> 5) & 0x07 });
    } else if (nalType === 34) {
        fields.push({ name: "pps_pic_parameter_set_id", value: data[4] & 0x3F });
        fields.push({ name: "pps_seq_parameter_set_id", value: data[6] & 0x1F });
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