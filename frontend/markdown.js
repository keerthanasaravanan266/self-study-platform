/*
 * Lightweight markdown renderer for AI-generated text (chatbot, summarizer, quiz).
 * No external dependency - just enough markdown support to stop raw **bold**,
 * # headers, and ```code``` fences from showing up as literal characters.
 *
 * Also detects ```mermaid fenced blocks and renders them as diagrams via
 * the Mermaid.js library (loaded separately in the page's <head>).
 */

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderMarkdown(rawText) {
    const text = String(rawText || "");

    // 1) Pull out fenced code blocks first so nothing inside them gets
    //    touched by the inline formatting rules below.
    const blocks = [];
    let withoutCode = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
        const index = blocks.length;
        blocks.push({ lang: (lang || "").toLowerCase().trim(), code: code.replace(/\n$/, "") });
        return `@@CODEBLOCK${index}@@`;
    });

    // 2) Escape the remaining text, then apply inline formatting.
    let html = escapeHtml(withoutCode);

    // Headers
    html = html.replace(/^### (.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.*)$/gm, "<h2>$1</h2>");

    // Bold / italics
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Unordered / numbered lists: wrap consecutive "- item" or "1. item" lines in <ul>/<ol>
    html = html.replace(/(^|\n)((?:[-*] .*(?:\n|$))+)/g, (match, lead, block) => {
        const items = block.trim().split("\n").map(l => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("");
        return `${lead}<ul>${items}</ul>`;
    });
    html = html.replace(/(^|\n)((?:\d+\. .*(?:\n|$))+)/g, (match, lead, block) => {
        const items = block.trim().split("\n").map(l => `<li>${l.replace(/^\d+\.\s+/, "")}</li>`).join("");
        return `${lead}<ol>${items}</ol>`;
    });

    // Remaining newlines -> line breaks (but not inside the <ul>/<ol> we just built)
    html = html.replace(/\n(?!<\/?(ul|ol|li)>)/g, "<br>");

    // 3) Re-insert code blocks (mermaid gets a special container, everything
    //    else becomes a normal <pre><code> block).
    html = html.replace(/@@CODEBLOCK(\d+)@@/g, (match, i) => {
        const block = blocks[Number(i)];
        if (!block) return "";
        if (block.lang === "mermaid") {
            return `<div class="mermaid">${escapeHtml(block.code)}</div>`;
        }
        return `<pre class="code-block"><code>${escapeHtml(block.code)}</code></pre>`;
    });

    return html;
}

// Renders markdown into `container` (an element or element id) and, if the
// Mermaid.js library is loaded on the page, renders any mermaid diagrams
// found inside it.
function renderMarkdownInto(container, rawText) {
    const el = typeof container === "string" ? document.getElementById(container) : container;
    if (!el) return;

    el.innerHTML = renderMarkdown(rawText);

    if (window.mermaid) {
        const diagrams = el.querySelectorAll(".mermaid");
        if (diagrams.length > 0) {
            try {
                window.mermaid.run({ nodes: diagrams });
            } catch (err) {
                console.error("Mermaid render error:", err);
            }
        }
    }
}
