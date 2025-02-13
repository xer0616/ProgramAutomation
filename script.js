document.addEventListener("DOMContentLoaded", function () {
    const version = "1.0.1";
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
        if (!fieldsContainer) {
            console.error("fieldsContainer not found");
            return;
        }
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
            fields.push({ name: "vps_video_parameter_set_id", value: data[5] & 0x0F });
            fields.push({ name: "vps_max_layers_minus1", value: (data[6] >> 3) & 0x1F });
            fields.push({ name: "vps_max_sub_layers_minus1", value: data[6] & 0x07 });
        } else if (nalType === 33) {
            fields.push({ name: "sps_seq_parameter_set_id", value: data[5] & 0x1F });
            fields.push({ name: "sps_max_sub_layers_minus1", value: (data[6] >> 5) & 0x07 });
        } else if (nalType === 34) {
            fields.push({ name: "pps_pic_parameter_set_id", value: data[5] & 0x3F });
            fields.push({ name: "pps_seq_parameter_set_id", value: data[6] & 0x1F });
        }
        return fields;
    }

    function displayFields(nalName, fields) {
        const container = document.getElementById("fieldsContainer");
        if (!container) {
            console.error("fieldsContainer not found when displaying fields");
            return;
        }
        fields.forEach(field => {
            const fieldDiv = document.createElement("div");
            fieldDiv.className = "field";
            fieldDiv.innerHTML = `<label>${nalName} - ${field.name}:</label> 
                                  <input type="text" value="${field.value}">`;
            container.appendChild(fieldDiv);
        });
    }

    document.getElementById("applyChangesBtn").addEventListener("click", function () {
        const inputs = document.querySelectorAll("#fieldsContainer input");
        const newValues = {};
        inputs.forEach(input => {
            const label = input.previousSibling.textContent;
            newValues[label] = input.value;
        });
        updateStream(newValues);
    });

    document.getElementById("downloadBtn").addEventListener("click", function () {
        const modifiedData = modifyStream();
        const blob = new Blob([modifiedData], { type: "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "updated.h265";
        a.click();
    });

    function updateStream(newValues) {
        console.log("Updated values:", newValues);
    }

    function modifyStream() {
        return originalData || new Uint8Array([]);
    }
});
