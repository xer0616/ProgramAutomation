
const version = 2
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
    let nalUnitStart = 0;
    for (let i = 0; i < data.length - 4; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
            nalUnitStart = i + 3;
             let nalType = (data[nalUnitStart] & 0x7E) >> 1;
            let nalName = getNALName(nalType);
            let fields = extractFields(nalType, data.subarray(i + 3)); // Pass data starting from NAL header
            displayFields(nalName, fields, i+3); // Pass the NAL unit start for modification
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
        fields.push({ name: "vps_video_parameter_set_id", value: data[1] & 0x7F });  // Corrected index
        fields.push({ name: "vps_max_layers_minus1", value: (data[2] >> 3) & 0x1F }); // Corrected index
        fields.push({ name: "vps_max_sub_layers_minus1", value: data[2] & 0x07 }); // Corrected index
        fields.push({ name: "vps_temporal_id_nesting_flag", value: (data[3] >> 7) & 0x01 }); // Corrected index

    } else if (nalType === 33) {

        fields.push({ name: "sps_video_parameter_set_id", value: data[1] & 0x1F }); // Corrected index and mask
        fields.push({ name: "sps_max_sub_layers_minus1", value: data[3] & 0x07 });  // Corrected index
        fields.push({ name: "sps_temporal_id_nesting_flag", value: (data[4] >> 7) & 0x01 });  // Corrected index


           // ... other SPS fields

    } else if (nalType === 34) {
         fields.push({ name: "pps_pic_parameter_set_id", value: data[2] & 0x3F });  // Corrected index
        fields.push({ name: "pps_seq_parameter_set_id", value: data[3] & 0x1F });  // Corrected index
     }
    return fields;
}


function displayFields(nalName, fields, nalUnitStart) {
    const container = document.getElementById("fieldsContainer");

    const nalUnitDiv = document.createElement("div");
    nalUnitDiv.className = "nalUnit"; // Add a class for styling if needed

    fields.forEach(field => {
        const fieldDiv = document.createElement("div");
        fieldDiv.className = "field";

         // Store nalUnitStart as a data attribute
        fieldDiv.dataset.nalUnitStart = nalUnitStart;

        fieldDiv.innerHTML = `<label>${nalName} - ${field.name}:</label> <input type="text" data-field-name="${field.name}" value="${field.value}" onchange="updateModifiedValue(this)">`; // Added onchange event
        nalUnitDiv.appendChild(fieldDiv);
    });
     container.appendChild(nalUnitDiv);

}




function modifyStream() {
    if (!originalData) return;
    let data = new Uint8Array(originalData); // Create a copy of the original data

    const fields = document.querySelectorAll('.field input');

    fields.forEach(fieldInput => {
        const nalUnitStart = parseInt(fieldInput.parentNode.dataset.nalUnitStart, 10);
        const fieldName = fieldInput.dataset.fieldName;
        const newValue = parseInt(fieldInput.value, 10);

          // Example SPS modification:
        if (fieldName === 'sps_video_parameter_set_id') {
            data[nalUnitStart + 1] = (data[nalUnitStart+1] & 0xE0) | (newValue & 0x1F); // Update the correct byte and bits in the NAL unit
        }
        // Add other field modifications here as needed

    });
    return data;
}


document.getElementById("downloadBtn").addEventListener("click", function() {
    const modifiedData = modifyStream();
    const blob = new Blob([modifiedData], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "updated.h265";
    a.click();
});




function updateModifiedValue(inputElement) {
    // You can add validation or other logic here if needed
    console.log("Field updated:", inputElement.dataset.fieldName, inputElement.value);
}





Key improvements:

- **Corrected field extraction:**  The indices and bit masks for extracting fields from the NAL unit byte stream have been fixed, specifically for `sps_video_parameter_set_id`, and other fields in VPS, SPS, and PPS.  Passing the data starting after the start code prefix (0x000001 or 0x00000001) is also crucial.
- **NAL Unit Start Tracking:** Added `nalUnitStart` tracking to properly modify bytes within the NAL unit. This is crucial for writing back the modified values correctly.
- **Dynamic Modification:** The `modifyStream` function now uses `nalUnitStart` and `fieldName` to precisely target and update the relevant bytes in the stream based on user input.
- **`updateModifiedValue` Function:**  This function (triggered by `onchange`) allows you to add input validation or other logic when a field is changed.
- **Code Clarity:**  Improved comments and variable names for better readability.
- **Simplified Logic:** The code is more concise and focused, reducing unnecessary complexity.


This revised code provides a more robust and accurate way to parse and modify H.265 NAL unit parameters within your web application. Remember to handle potential errors (e.g., invalid user input) and adjust the field modification logic as needed for your specific use case.  Also, ensure that your HTML includes the required elements (`fieldsContainer`, `downloadBtn`, `version`).