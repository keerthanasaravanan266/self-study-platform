// Notification toggle
function toggleNotification() {
    const bell = document.getElementById("bell");
    bell.classList.toggle("active");
    alert("Notifications turned ON");
}

// Load Uploaded Materials
function loadMaterialsFromDB() {

    const userId = sessionStorage.getItem("userId");

    if (!userId) return;

    fetch(`${API_BASE}/api/materials/` + userId)
    .then(res => res.json())
    .then(data => {

        const docs = document.getElementById("docs");
        const links = document.getElementById("links");
        const media = document.getElementById("media");

        docs.innerHTML = "";
        links.innerHTML = "";
        media.innerHTML = "";

        data.forEach(item => {

            if(item.type === "Document"){
    docs.innerHTML += `
        <p>
            📄 <a href="${item.file_path}" target="_blank">
                ${item.title}
            </a>
        </p>
    `;
}

            if(item.type === "Link"){
                links.innerHTML += `<p><a href="${item.title}" target="_blank">${item.title}</a></p>`;
            }

           if(item.type === "Media"){
    media.innerHTML += `
        <p>
            🎥 <a href="${item.file_path}" target="_blank">
                ${item.title}
            </a>
        </p>
    `;
}

        });

    })
    .catch(err => console.log(err));
}



// Load Pasted Materials
function loadPastedMaterials() {

    const userId = sessionStorage.getItem("userId");

    fetch(`${API_BASE}/api/materials/pasted/${userId}`)
    .then(res => res.json())
    .then(data => {

        console.log("Pasted materials:", data);

        const textSection = document.getElementById("text");
        const websiteSection = document.getElementById("website");
        const linkSection = document.getElementById("plink");

        if (!textSection || !websiteSection || !linkSection) return;

        textSection.innerHTML = "";
        websiteSection.innerHTML = "";
        linkSection.innerHTML = "";

        if(data.length === 0){
            textSection.innerHTML = "<p>No text saved.</p>";
            websiteSection.innerHTML = "<p>No websites saved.</p>";
            linkSection.innerHTML = "<p>No links saved.</p>";
            return;
        }

        data.forEach(item => {

            if(item.type === "Text"){
                textSection.innerHTML += `<p>${item.content}</p>`;
            }

            else if(item.type === "Website"){
                websiteSection.innerHTML += `<p><a href="${item.content}" target="_blank">${item.content}</a></p>`;
            }

            else if(item.type === "Link"){
                linkSection.innerHTML += `<p><a href="${item.content}" target="_blank">${item.content}</a></p>`;
            }

        });

    })
    .catch(err => console.error(err));
}


// Upload Material
function uploadMaterial(inputId, type) {

    const input = document.getElementById(inputId);

    if (!input) {
        alert("Input not found");
        return;
    }

    const categoryInput = document.getElementById("uploadCategory");
    const category = (categoryInput && categoryInput.value.trim()) || "Uncategorized";

    // ✅ CASE 1: FILE UPLOAD
    if (input.type === "file") {

        if (input.files.length === 0) {
            alert("Select a file first");
            return;
        }

        const formData = new FormData();
        formData.append("file", input.files[0]);
        formData.append("user_id", sessionStorage.getItem("userId"));
        formData.append("type", type);
        formData.append("category", category);

        fetch(`${API_BASE}/api/materials/upload`, {
            method: "POST",
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            alert(data.message);
            loadMaterialsFromDB();
        });

    }

    // ✅ CASE 2: YOUTUBE LINK
    else {

        const link = input.value.trim();

        if (!link) {
            alert("Enter a link first");
            return;
        }

        fetch(`${API_BASE}/api/materials/upload`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                user_id: sessionStorage.getItem("userId"),
                type: type,
                title: link,
                file_path: link,
                category: category
            })
        })
        .then(async res => {
    const text = await res.text();

    try {
        return JSON.parse(text);
    } catch {
        console.error("Server returned HTML:", text);
        throw new Error("Server error");
    }
})
.then(data => {
    alert(data.message);
    loadMaterialsFromDB();
})
.catch(err => {
    console.error(err);
    alert("Upload failed");
});

    }
}



// Paste Material
function pasteMaterial(inputId, type) {

    const input = document.getElementById(inputId);

    if (!input || !input.value.trim()) {
        alert("Please enter content");
        return;
    }

    const content = input.value;

    const categoryInput = document.getElementById("pasteCategory");
    const category = (categoryInput && categoryInput.value.trim()) || "Uncategorized";

    fetch(`${API_BASE}/api/materials/paste`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            user_id: sessionStorage.getItem("userId"),
            type: type,
            content: content,
            category: category
        })
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
        loadPastedMaterials();
        input.value = ""; // clear input
    })
    .catch(err => console.log(err));
}



function sendMessage() {

    const input = document.getElementById("userMessage");
    const chatBox = document.getElementById("chatBox");

    const message = input.value.trim();

    if (!message) return;

    // Show user message
    chatBox.innerHTML += `<p><b>You:</b> ${message}</p>`;

    // Send to backend
    fetch(`${API_BASE}/api/chatbot`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: message
        })
    })
    .then(res => res.json())
    .then(data => {

        chatBox.innerHTML += `<p><b>AI:</b> ${data.reply}</p>`;

        chatBox.scrollTop = chatBox.scrollHeight;

    })
    .catch(err => console.error(err));

    input.value = "";
}