import "./style.css";

interface SelectedFile {
  file: File;
  id: string;
}

const app = document.getElementById("app")!;

interface MergeResult {
  url: string;
  fileName: string;
  statsText: string;
}

let selectedFiles: SelectedFile[] = [];
let isMerging = false;
let mergeResult: MergeResult | null = null;

function render(): void {
  setupDropzone();
  renderFileList();
  renderActions();
}

function setupDropzone(): void {
  const dropzone = document.getElementById("dropzone")!;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;

  dropzone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = "";
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });
}

function addFiles(fileList: FileList | File[]): void {
  const files = Array.from(fileList);
  for (const file of files) {
    const isGpx =
      file.name.toLowerCase().endsWith(".gpx") ||
      file.type.includes("gpx") ||
      file.type.includes("xml");
    if (!isGpx) continue;
    if (selectedFiles.some((f) => f.file.name === file.name)) continue;
    selectedFiles.push({ file, id: crypto.randomUUID() });
  }
  renderFileList();
  renderActions();
}

function renderFileList(): void {
  const list = document.getElementById("fileList")!;
  list.innerHTML = selectedFiles
    .map(
      (f) => `
      <li class="file-item" data-id="${f.id}">
        <span class="name">${f.file.name}</span>
        <button class="remove" data-remove="${f.id}">✕</button>
      </li>
    `
    )
    .join("");

  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.remove!;
      selectedFiles = selectedFiles.filter((f) => f.id !== id);
      renderFileList();
      renderActions();
    });
  });
}

function clearMergeResult(): void {
  if (mergeResult) {
    URL.revokeObjectURL(mergeResult.url);
    mergeResult = null;
  }
}

function downloadMergeResult(): void {
  if (!mergeResult) return;
  const a = document.createElement("a");
  a.href = mergeResult.url;
  a.download = mergeResult.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderActions(): void {
  const actions = document.getElementById("actions")!;
  const canMerge = selectedFiles.length >= 2 && !isMerging;

  const resultHtml = mergeResult
    ? `
      <div class="result" id="messageArea">
        <div class="message success">${mergeResult.statsText}</div>
        <div class="file-item result-file">
          <span class="name">${mergeResult.fileName}</span>
          <span class="ready-label">Ready</span>
        </div>
        <button type="button" class="btn-download" id="downloadBtn">
          Download ${mergeResult.fileName}
        </button>
      </div>
    `
    : `<div id="messageArea"></div>`;

  actions.innerHTML = `
    <button class="btn-merge" id="mergeBtn" ${canMerge ? "" : "disabled"}>
      ${isMerging ? "Merging..." : "Merge GPX files"}
    </button>
    ${resultHtml}
  `;

  document.getElementById("mergeBtn")!.addEventListener("click", handleMerge);
  document.getElementById("downloadBtn")?.addEventListener("click", downloadMergeResult);
}

async function handleMerge(): Promise<void> {
  if (selectedFiles.length < 2 || isMerging) return;

  isMerging = true;
  clearMergeResult();
  renderActions();

  const formData = new FormData();
  for (const f of selectedFiles) {
    formData.append("files", f.file);
  }

  try {
    const res = await fetch("/api/merge", { method: "POST", body: formData });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Merge failed" }));
      throw new Error(data.error || "Merge failed");
    }

    const blob = await res.blob();
    const statsHeader = res.headers.get("X-Merge-Stats");
    let statsText = "Merge complete. Your file is ready to download.";
    if (statsHeader) {
      try {
        const stats = JSON.parse(statsHeader);
        statsText = `Merge complete — ${stats.mergedPoints} points merged, ${stats.ignoredPoints} without timestamp ignored.`;
      } catch {
        /* ignore */
      }
    }

    mergeResult = {
      url: URL.createObjectURL(blob),
      fileName: "merged.gpx",
      statsText,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    isMerging = false;
    renderActions();
    const messageArea = document.getElementById("messageArea")!;
    messageArea.innerHTML = `<div class="message error">${msg}</div>`;
    return;
  }

  isMerging = false;
  renderActions();
}

render();
