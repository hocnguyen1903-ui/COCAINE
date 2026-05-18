// JS_Metadata_Engine.js
let METADATA_STORE = null;

async function initMetadataEngine() {
    const res = await callBackend("getMetadataSync");
    // Cache vào localStorage theo yêu cầu Architect
    localStorage.setItem("METADATA_CACHE", JSON.stringify(res));
    METADATA_STORE = res;
    renderForm("dataForm-hd", "_hd"); // Lọc các field có đuôi _hd
}

function renderForm(formId, suffix) {
    const form = document.getElementById(formId);
    const fields = METADATA_STORE.metadata.filter(f => f.id.endsWith(suffix));
    const rows = fields.reduce((acc, f) => { (acc[f.row] = acc[f.row] || []).push(f); return acc; }, {});

    form.innerHTML = Object.keys(rows).sort((a,b) => a-b).map(r => `
        <div class="m-row">
            ${rows[r].map(f => `
                <div class="m-col" style="flex: 0 0 calc(${(f.width/12)*100}% - 15px)">
                    <label class="m-label">${f.label}</label>
                    ${renderInput(f)}
                </div>
            `).join('')}
        </div>
    `).join('');
}

function renderInput(f) {
    const src = METADATA_STORE.sources[f.id] || [];
    if (f.type === 'currency') return `<input type="text" id="${f.id}" oninput="maskMoney(this)" placeholder="${f.placeholder}">`;
    if (f.type === 'dropdown') return `<select id="${f.id}"><option value="">${f.placeholder}</option>${src.map(o => `<option value="${o[0]}">${o[0]}</option>`).join('')}</select>`;
    if (f.type === 'radio') return `<div class="m-radio-group">${src.map(o => {
        const [l, v] = o[0].split(':');
        return `<label><input type="radio" name="${f.id}" value="${v||l}"> ${l}</label>`;
    }).join('')}</div>`;
    return `<input type="text" id="${f.id}" placeholder="${f.placeholder}">`;
}

function maskMoney(el) {
    let v = el.value.replace(/\D/g, "");
    el.value = v.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function submitMetadataForm() {
    const payload = {};
    METADATA_STORE.metadata.forEach(f => {
        const el = document.getElementById(f.id) || document.querySelector(`input[name="${f.id}"]:checked`);
        if (el) payload[f.id] = (f.type === 'currency') ? el.value.replace(/\./g, "") : el.value;
    });
    const res = await callBackend("processInjection", payload);
    if(res.success) alert("Đã tiêm dữ liệu thành công!");
}