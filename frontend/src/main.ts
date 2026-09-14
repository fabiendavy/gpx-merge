import "./style.css";

interface SelectedFile {
  file: File;
  id: string;
}

const app = document.getElementById("app")!;

let selectedFiles: SelectedFile[] = [];
let isMerging = false;

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

function renderActions(): void {
  const actions = document.getElementById("actions")!;
  const canMerge = selectedFiles.length >= 2 && !isMerging;

  actions.innerHTML = `
    <button class="btn-merge" id="mergeBtn" ${canMerge ? "" : "disabled"}>
      ${isMerging ? "Merging..." : "Merge GPX files"}
    </button>
    <div id="messageArea"></div>
  `;

  const mergeBtn = document.getElementById("mergeBtn")!;
  mergeBtn.addEventListener("click", handleMerge);
}

async function handleMerge(): Promise<void> {
  if (selectedFiles.length < 2 || isMerging) return;

  isMerging = true;
  renderActions();

  const messageArea = document.getElementById("messageArea")!;
  messageArea.innerHTML = "";

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged.gpx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const statsHeader = res.headers.get("X-Merge-Stats");
    let statsText = "Merge complete! Downloading merged.gpx";
    if (statsHeader) {
      try {
        const stats = JSON.parse(statsHeader);
        statsText = `Merge complete! Downloading merged.gpx — ${stats.mergedPoints} points merged, ${stats.ignoredPoints} without timestamp ignored.`;
      } catch {
        /* ignore */
      }
    }

    messageArea.innerHTML = `<div class="message success">${statsText}</div>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    messageArea.innerHTML = `<div class="message error">${msg}</div>`;
  } finally {
    isMerging = false;
    renderActions();
  }
}

render();
