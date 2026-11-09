'use strict';
// UI-only localization. Dataset names, prompts, paths and YOLO class IDs are data.
window.AxiomI18n = (() => {
  const zh = {
    'Axiom — YOLO Auto Label': 'Axiom — YOLO 自動標註',
    'YOLO AUTO LABEL': 'YOLO 自動標註', 'Axiom logo': 'Axiom 標誌',
    'Language': '語言', 'Current dataset': '目前資料集', 'New dataset': '新增資料集',
    'Workspace': '工作區', 'Annotate': '標註', 'Train': '訓練', 'Saved': '已儲存',
    'Export YOLO ↗': '匯出 YOLO ↗', 'Annotate images': '圖片標註', '+ Add images': '+ 加入圖片',
    '✦ Auto label': '✦ 自動標註', 'Auto label': '自動標註', 'Auto label settings': '自動標註設定',
    'Select / move (V)': '選取／移動（V）', 'Select': '選取', 'Draw a box (B)': '繪製標註框（B）', 'Draw': '畫框',
    'Undo (Ctrl+Z)': '復原（Ctrl+Z）', 'Redo (Ctrl+Y)': '重做（Ctrl+Y）',
    'Zoom out': '縮小', 'Zoom in': '放大', 'Fit': '適合', 'Previous image (←)': '上一張（←）',
    'Previous image': '上一張', 'Next image (→)': '下一張（→）', 'Next image': '下一張',
    'Image annotation editor': '圖片標註編輯器', 'Start with your images': '從加入圖片開始',
    'Drop images or a folder here, or choose files below.': '將圖片或資料夾拖曳至此，或點擊下方按鈕選取。',
    'Add images': '加入圖片', 'Review & export': '確認並匯出',
    'Drag to draw · Use Select to move or resize · ← → next image': '拖曳畫框 · 使用選取工具移動或調整 · ← → 切換圖片',
    'Filter images': '篩選圖片', 'All': '全部', 'To label': '待標註', 'Auto labeled': '已自動標註',
    'Reviewed': '已確認', 'Errors': '有問題', 'All images': '全部圖片', 'Pending': '待標註',
    'Needs attention': '需要處理', 'pending': '待標註', 'auto': '已自動標註', 'reviewed': '已確認', 'error': '有問題',
    'Search images…': '搜尋圖片…', 'Search images': '搜尋圖片', 'Previous page': '上一頁', 'Next page': '下一頁',
    'Your images will appear here.': '加入的圖片會顯示在這裡。', 'No matching images.': '找不到符合的圖片。',
    'Train a model': '訓練模型', 'Turn your reviewed labels into a YOLO detector.': '使用已確認的標註，訓練你的 YOLO 偵測模型。',
    '▶ Start training': '▶ 開始訓練', 'Train your YOLO detector': '訓練 YOLO 偵測模型',
    'Use your saved annotations to train a compact detector locally. A separate validation set is created automatically.': '以儲存的標註在本機訓練模型，並自動建立獨立驗證集。',
    'Epoch': '訓練輪數', 'Training loss': '訓練損失', 'TRAINING LOSS': '訓練損失', 'Loss per epoch': '每輪損失',
    'Training loss by epoch': '各訓練輪次的損失', 'Start a training run to see live metrics.': '開始訓練後，這裡會顯示即時指標。',
    'Ready to train?': '準備開始訓練？',
    'Use at least two labeled images. Training progress appears above, and your model is ready to download when the run finishes.': '至少需要兩張已標註圖片。訓練進度會顯示於上方，完成後即可下載模型。',
    'Download best.pt ↗': '下載 best.pt ↗', 'Training settings': '訓練設定', 'YOLO model': 'YOLO 模型', 'Epochs': '訓練輪數',
    'More training options': '更多訓練選項', 'Training image size': '訓練圖片尺寸', 'Training batch size': '訓練批次大小',
    'Validation split': '驗證集比例', 'Random seed': '隨機種子',
    'Uses labeled and reviewed images. Training and validation require at least two images.': '使用已標註或已確認的圖片，訓練與驗證至少需要兩張。',
    'Labels': '標註', 'Delete selected box': '刪除選取的標註框', 'New box class': '新標註框類別',
    'Draw a box, then drag its corners to adjust it.': '畫出標註框後，可拖曳四角調整大小。',
    'Select an image to view its labels.': '選取圖片以查看標註。', '✓ Reviewed · Next →': '✓ 確認並下一張 →',
    'Remove image': '移除圖片', 'Dataset classes': '資料集類別', 'Remove image?': '移除這張圖片？',
    'Remove this image and its labels from this dataset. The original file will be kept.': '將從資料集移除此圖片及其標註，原始檔案會保留。',
    'Cancel': '取消', 'Close': '關閉', 'Choose what to find. Axiom handles the rest.': '選擇要尋找的目標，交給 Axiom 自動標註。',
    'Game name': '遊戲名稱', 'optional': '選填', 'e.g. Valorant, Overwatch 2': '例如：Valorant、Overwatch 2',
    'Use a custom description': '自訂目標描述', 'What should Axiom find?': '想要標註什麼目標？',
    'Describe the characters to detect': '描述要偵測的角色或物件', 'Separate teammates and enemies': '區分隊友與敵人',
    'Teammate description': '隊友描述', 'Friendly characters and their visual indicators': '描述隊友外觀與辨識特徵',
    'Enemy description': '敵人描述', 'Enemy characters and their visual indicators': '描述敵人外觀與辨識特徵',
    'Add head labels': '另外標註頭部', 'Body labels stay included. Heads use the same team split.': '仍會保留全身標註，頭部也會依設定區分敵我。',
    'To change team or head classes after labeling, create a new dataset.': '開始標註後，如需變更敵我或頭部類別，請建立新資料集。',
    'Model & image size': '模型與圖片尺寸', 'Vision model': '視覺模型', 'Precision': '精度／量化', 'Native': '原生',
    'Q4 saves VRAM. FP8 uses E4M3 weights.': 'Q4 可節省顯示記憶體，FP8 使用 E4M3 權重。',
    'Model weights download on first use.': '首次使用時會下載模型權重。', 'Normalize image size': '統一圖片尺寸',
    'Off — original resolution': '關閉 — 保留原始解析度', '1K — 1024 × 1024': '1K — 1024 × 1024',
    'Preserves aspect ratio with padding. Applies to inference and dataset exports.': '維持圖片比例並補邊，套用於推論與資料集匯出。',
    'Performance & advanced': '效能與進階設定', 'Inference batch size': '推論批次大小',
    '1 — lowest VRAM': '1 — 最省顯示記憶體', '8 — highest throughput': '8 — 最高處理量',
    'Vision pixel budget': '視覺像素上限',
    '1M — detailed': '1M — 精細', '2M — default': '2M — 預設', '4M — high resolution': '4M — 高解析度', '8M — 4K sources': '8M — 4K 原圖', 'Max output tokens': '輸出 Token 上限',
    '4M/8M need more VRAM and high-resolution originals.': '4M／8M 需要更多顯示記憶體，適合高解析度原圖。',
    'Skip labeled images': '略過已標註圖片', 'Only new images': '只標註新圖片', 'Manual reviews are always protected.': '手動確認過的標註會保留。',
    'Load model': '載入模型', 'Unload': '卸載', 'No model loaded': '尚未載入模型', 'Loaded on demand': '需要使用時自動載入',
    'Done': '完成', 'Start labeling': '開始標註', 'Add images to start.': '加入圖片即可開始。',
    'Import images to get started': '請先加入圖片', 'Stop': '停止', 'Download ZIP ↗': '下載 ZIP ↗',
    '≡ Activity': '≡ 記錄', 'ACTIVITY': '執行記錄', 'Activity log': '執行記錄', 'Close activity': '關閉執行記錄',
    'No activity yet.': '尚無執行記錄。', 'Drop files or folders anywhere, or choose one below.': '可直接拖入圖片或資料夾，或使用下方按鈕選取。',
    'Choose images': '選擇圖片', 'One or more files': '可一次選取多張', 'Choose a folder': '選擇資料夾',
    'Includes subfolders': '包含子資料夾', 'Or paste image / folder paths': '或貼上圖片／資料夾路徑',
    'Image or folder paths': '圖片或資料夾路徑', 'Add from path': '從路徑加入',
    'Common image formats supported. Original files are kept.': '支援常見圖片格式，並保留原始檔案。',
    'Dataset name': '資料集名稱', 'My game dataset': '我的遊戲資料集', 'Create dataset': '建立資料集',
    'Drop into Axiom': '拖曳至 Axiom', 'Images and folders. Ready to label.': '放入圖片或資料夾，即可開始標註。',
    'Label {count} image': '標註 {count} 張圖片', 'Label {count} images': '標註 {count} 張圖片', 'No images to label': '沒有待標註圖片',
    '{count} image to label. Reviewed images are kept.': '有 {count} 張待標註圖片，會保留已確認的標註。',
    '{count} images to label. Reviewed images are kept.': '有 {count} 張待標註圖片，會保留已確認的標註。',
    'Turn off “Only new images” to label automatic results again.': '關閉「只標註新圖片」，即可重新執行自動標註。',
    'All images are reviewed. Your edits are kept.': '所有圖片都已確認，會保留你的修改。',
    'Add images to begin. Settings save automatically.': '加入圖片即可開始，設定會自動儲存。',
    'Add your images to get started.': '加入圖片即可開始。', 'Run Auto label, or draw your own boxes.': '使用自動標註，或自行繪製標註框。',
    'Check the boxes, then confirm each image.': '檢查標註框，並逐張確認。', 'All images reviewed. Export your YOLO dataset.': '所有圖片都已確認，可以匯出 YOLO 資料集。',
    'Saving settings…': '正在儲存設定…', 'Settings not saved': '設定尚未儲存', 'Saving annotations…': '正在儲存標註…',
    'Save failed — edits retained': '儲存失敗 — 已保留修改', '{count} images': '{count} 張圖片',
    'No boxes yet. Draw a box or run Auto label.': '尚無標註，可自行畫框或使用自動標註。',
    'Class of box {count}': '第 {count} 個框的類別', 'target': '目標', 'teammate': '隊友', 'enemy': '敵人',
    'target_head': '目標頭部', 'teammate_head': '隊友頭部', 'enemy_head': '敵人頭部',
    'Drag to draw a box · Each change saves automatically': '拖曳以繪製標註框 · 修改會自動儲存',
    'Click a box to move it · Drag a corner to resize': '點選標註框即可移動 · 拖曳四角調整大小',
    'Reviewed and saved.': '已確認並儲存。', 'Reviewed and saved. You reached the last image.': '已確認並儲存，這是最後一張圖片。',
    'Image removed. Original file kept.': '已移除圖片，原始檔案仍保留。',
    'Wait for the current job to finish.': '請等待目前作業完成。', 'Enter a dataset name.': '請輸入資料集名稱。',
    'Paste an image or folder path.': '請貼上圖片或資料夾路徑。', 'No supported images found.': '找不到支援的圖片。',
    'Importing images · {done}/{total}': '正在加入圖片 · {done}/{total}',
    'Copying files into the local workspace': '正在將檔案複製到本機工作區',
    '{count} images imported{skipped}.': '已加入 {count} 張圖片{skipped}。',
    ' · {count} duplicates or unsupported files skipped': ' · 略過 {count} 個重複或不支援的檔案',
    'Describe both teammates and enemies.': '請分別描述隊友與敵人。', 'Describe what Axiom should find.': '請描述要標註的目標。',
    'Image could not be opened. Check the source path.': '無法開啟圖片，請檢查原始檔案路徑。',
    'Connection interrupted — reconnecting…': '連線中斷 — 正在重新連線…',
    '{count} errors': '{count} 個錯誤', '{done}/{total} images': '{done}/{total} 張圖片', '{done}/{total} epochs': '{done}/{total} 輪',
    '{rate} img/s': '{rate} 張／秒', 'ETA {time}': '預估剩餘 {time}', 'Epoch {count}': '第 {count} 輪',
    '{count}s': '{count} 秒', '{minutes}m {seconds}s': '{minutes} 分 {seconds} 秒', '{hours}h {minutes}m': '{hours} 小時 {minutes} 分',
    'Ready when you are.': '準備就緒。', 'Import complete.': '圖片加入完成。', 'Annotation complete.': '自動標註完成。',
    'Export complete.': '匯出完成。', 'Training complete.': '訓練完成。', 'Model loading complete.': '模型載入完成。',
    'Model unload complete.': '模型卸載完成。', 'Packaging YOLO dataset…': '正在封裝 YOLO 資料集…',
    'Loading weights into memory…': '正在載入模型權重…', 'Quantizing decoder weights to FP8 E4M3…': '正在將解碼器權重量化為 FP8 E4M3…',
    'Starting YOLO training…': '正在啟動 YOLO 訓練…', 'Starting training…': '正在準備訓練…',
    'Stopped. Completed work has been saved.': '已停止，完成的工作已儲存。',
    'Stopping after the current operation. Downloads may finish their current request.': '將於目前步驟結束後停止，下載可能需等待目前請求完成。',
    'Previous job was interrupted. Saved labels are intact; run again to resume.': '上次作業中斷，已儲存的標註仍保留，可再次執行以繼續。',
    'Image not found.': '找不到圖片。', 'Project not found.': '找不到項目。', 'Dataset name is required.': '請輸入資料集名稱。',
    'Project name is required.': '請輸入項目名稱。', 'Image revision is required.': '缺少圖片版本資訊，請重新載入。',
    'This image changed in another editor. Reload it before saving.': '這張圖片已在其他視窗修改，請重新載入後再儲存。',
    'This image changed in another editor. Reload it before removing it.': '這張圖片已在其他視窗修改，請重新載入後再移除。',
    'A job is running. Wait for it to finish before changing this dataset.': '目前有作業正在執行，請等待完成後再修改資料集。',
    'Another job is running. Stop it or wait for it to finish.': '另一項作業正在執行，請先停止或等待完成。',
    'Class layout is locked after labeling. Create a new dataset to change team or head classes.': '標註後類別配置會鎖定，如需變更敵我或頭部類別，請建立新資料集。',
    'Invalid annotation class.': '標註類別無效。', 'Box coordinates must be finite normalized values in [0, 1].': '標註框座標必須是 0 至 1 之間的有效數值。',
    'A box must have a positive width and height.': '標註框的寬度與高度必須大於零。', 'Invalid image selection.': '圖片選取無效。',
    'Label or review at least one image before exporting.': '匯出前，請至少標註或確認一張圖片。',
    'Training needs at least two labeled/reviewed images for separate training and validation sets.': '訓練至少需要兩張已標註或已確認的圖片，以建立獨立訓練集與驗證集。',
    'Q4 requires a CUDA GPU. Select Native for CPU inference.': 'Q4 需要 CUDA 顯示卡，使用 CPU 時請選擇原生精度。',
    'No pending images. Turn off Skip labeled images to rerun automatic labels.': '沒有待標註圖片，關閉「只標註新圖片」即可重新執行。',
    'All selected images have manual reviews. Reviewed images are protected from automatic replacement.': '選取的圖片均已手動確認，自動標註不會覆蓋這些修改。',
    'YOLO training failed. See the activity log for details.': 'YOLO 訓練失敗，請查看執行記錄。',
    'Path does not exist.': '路徑不存在。', 'Unsupported image format.': '不支援的圖片格式。', 'Image exceeds 512 MB.': '圖片超過 512 MB。',
    'Provide one or more image or folder paths.': '請提供至少一個圖片或資料夾路徑。',
    'Validation split must be between 5% and 50%.': '驗證集比例必須介於 5% 至 50%。',
    'Model response did not contain structured boxes or None. Try a shorter, concrete description.': '模型未回傳有效標註框或無目標結果，請使用更簡短、具體的描述。',
    'Incomplete model box coordinates. Increase the output token limit.': '模型回傳的框座標不完整，請提高輸出 Token 上限。',
    'Model returned out-of-range coordinates.': '模型回傳的座標超出範圍。',
    'Output token limit reached. Increase Max output tokens and retry this image.': '已達輸出 Token 上限，請提高上限後重試這張圖片。',
    'Class settings changed while annotating. Result was not saved.': '標註時類別設定已變更，本次結果未儲存。',
    'Describe the target.': '請描述要標註的目標。', 'Upload at most 100 files per request.': '每次最多可加入 100 個檔案。',
    'Expected a list of at most 2,000 boxes.': '標註框清單最多可包含 2,000 個框。',
    'Training requires Ultralytics. Run Setup.bat to install dependencies.': '訓練需要 Ultralytics，請執行 Setup.bat 安裝相依套件。',
    'No supported language decoder layers found for FP8 quantization.': '找不到可進行 FP8 量化的語言解碼器層。',
    'Drag thumbnails to select · Ctrl+A all · Backspace remove': '拖曳縮圖框選 · Ctrl+A 全選 · Backspace 移除',
    'Select all': '全選', 'Clear': '取消選取', 'Remove selected': '移除選取圖片', 'Selecting images…': '正在選取圖片…',
    '{count} selected': '已選取 {count} 張', 'Remove {count} images': '移除 {count} 張圖片',
    '{count} images removed. Original files kept.': '已移除 {count} 張圖片，原始檔案仍保留。',
    'Some selected images changed or were removed. Select them again before removing.': '部分選取圖片已被修改或移除，請重新選取後再移除。',
    'Select between 1 and 100,000 images to remove.': '請選取 1 至 100,000 張要移除的圖片。',
    'Projects': '項目', 'Current project': '目前項目', 'New project': '新增項目', '+ New project': '+ 新增項目',
    'Project name': '項目名稱', 'My game project': '我的遊戲項目', 'Create project': '建立項目',
    'Keep each dataset, its labels and settings in one place.': '各項目的圖片、標註與設定，分開保存、隨時切換。',
    'No projects yet': '尚無項目', 'Create a project to start adding images.': '建立項目後，即可加入圖片。',
    'No project selected': '尚未選取項目', '{count} projects': '{count} 個項目', '{count} reviewed': '已確認 {count} 張',
    '{count} image': '{count} 張圖片',
    'Open project →': '開啟項目 →', 'Rename': '重新命名', 'Delete': '刪除', 'Rename project': '重新命名項目',
    'Rename project: {name}': '重新命名項目：{name}', 'Delete project: {name}': '刪除項目：{name}',
    'Save name': '儲存名稱', 'Enter a project name.': '請輸入項目名稱。', 'Delete project?': '刪除這個項目？',
    'Delete project': '刪除項目', 'This removes the project and its {count} images and labels. Original files are kept.': '將刪除此項目及其 {count} 張圖片與標註資料，原始檔案仍會保留。',
    'Project renamed.': '已重新命名項目。', 'Project created.': '項目已建立。', 'Project deleted. Original files kept.': '項目已刪除，原始檔案仍保留。',
    'Project name must be at most 100 characters.': '項目名稱最多可包含 100 個字元。',
    'This project has an active job. Stop it before deleting the project.': '此項目有作業正在執行，請先停止作業再刪除項目。',
    'Drop images, videos or a folder here, or choose files below.': '將圖片、影片或資料夾拖曳至此，或使用下方按鈕選取。',
    'Drop images, videos or folders anywhere, or choose one below.': '可直接拖入圖片、影片或資料夾，或使用下方按鈕選取。',
    'Choose video': '選擇影片', 'Extract selected frames': '擷取指定區間的圖片',
    'Or paste image / video / folder paths': '或貼上圖片／影片／資料夾路徑',
    'Images, videos and folders. Ready to label.': '放入圖片、影片或資料夾，即可開始標註。',
    'Import video frames': '從影片擷取圖片', 'Reading video metadata…': '正在讀取影片資訊…',
    'Preview unavailable in this browser. You can still extract frames.': '此瀏覽器無法預覽這段影片，仍可擷取圖片。',
    'Start time': '開始時間', 'End time': '結束時間', 'Use current playback time': '使用目前播放時間',
    '1:30 or 1.5': '1:30 或 1.5', '3:00 or 3': '3:00 或 3',
    'Enter minutes or mm:ss. For example, 1:30 means 1 minute 30 seconds.': '可輸入分鐘或 mm:ss，例如 1:30 表示 1 分 30 秒。',
    'Seconds per image': '每隔幾秒擷取一張', 'Frames are sampled from the start up to the end time.': '從開始時間起，依設定間隔擷取至結束時間之前。',
    'Frames will be added to {name}.': '擷取的圖片會加入「{name}」。',
    '{count} images will be extracted': '預計擷取 {count} 張圖片', 'Import {count} frames': '匯入 {count} 張圖片',
    'Import frames': '匯入擷取圖片', 'Uploading video · {percent}%': '正在匯入影片 · {percent}%',
    'Video import complete.': '影片擷取完成。',
    'Create or open a project before importing media.': '請先建立或開啟項目，再匯入圖片或影片。',
    'No supported images or videos found.': '找不到支援的圖片或影片。',
    'Open the original project before importing the remaining videos.': '請先回到原本的項目，再匯入剩餘影片。',
    'Video upload failed. Please try again.': '影片匯入失敗，請再試一次。',
    'Enter valid video start, end and interval values.': '請輸入有效的開始時間、結束時間與擷取間隔。',
    'The frame interval must be between 0.05 and 86400 seconds.': '擷取間隔必須介於 0.05 至 86400 秒。',
    'The clip must start before its end and stay within the video duration.': '開始時間必須早於結束時間，且不可超過影片長度。',
    'This clip would produce more than 50,000 images. Increase the interval or shorten the clip.': '這個區間將產生超過 50,000 張圖片，請增加間隔或縮短區間。',
    'Video import requires FFmpeg. Run Setup.bat to install it.': '影片匯入需要 FFmpeg，請執行 Setup.bat 安裝。',
    'Video file not found.': '找不到影片檔案。', 'Video not found.': '找不到影片。', 'Unsupported video format.': '不支援的影片格式。',
    'Could not read video duration or dimensions. The file may be damaged or unsupported.': '無法讀取影片長度或尺寸，檔案可能已損壞或格式不支援。',
    'The video has no readable frames.': '此影片沒有可讀取的影格。',
    'The selected clip contains no decodable frames.': '選取的時間區間沒有可擷取的影格。',
    'The video file changed. Import it again before extracting frames.': '影片檔案已變更，請重新匯入後再擷取。',
    'Provide a video file path.': '請提供影片檔案路徑。', 'Choose a video before extracting frames.': '請先選擇影片，再擷取圖片。',
    'Video exceeds the 32 GB upload limit. Use a local file path instead.': '影片超過 32 GB 匯入限制，請改用本機檔案路徑。',
  };
  let locale = 'en';
  try { if (localStorage.getItem('axiom.language') === 'zh-TW') locale = 'zh-TW'; } catch (_) {}
  const nodes = [], attributes = [];
  const normalize = value => value.trim().replace(/\s+/g, ' ');
  function t(key, values = {}) {
    const template = locale === 'zh-TW' ? (zh[key] ?? key) : key;
    return template.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  }
  // Backend remains language-neutral; translate known user-facing status formats here.
  function message(raw) {
    const value = String(raw ?? '');
    if (locale !== 'zh-TW') return value;
    if (zh[value]) return zh[value];
    const patterns = [
      [/^Starting (import|annotation|export|training|model loading|model unload|video import)…$/, m => `正在${({import:'加入圖片',annotation:'開始標註',export:'準備匯出',training:'準備訓練','model loading':'載入模型','model unload':'卸載模型','video import':'擷取影片圖片'})[m[1]]}…`],
      [/^Extracting video frames · (\d+)\/(\d+) · (.+)$/, m => `正在擷取影片圖片 · ${m[1]}/${m[2]} · ${m[3]}`],
      [/^Video frame extraction failed\. (.+)$/s, m => `影片擷取失敗。${m[1]}`],
      [/^Scanning images · (\d+) added · (\d+) duplicates · (\d+) skipped$/, m => `正在掃描圖片 · 已加入 ${m[1]} 張 · 重複 ${m[2]} 張 · 略過 ${m[3]} 張`],
      [/^Labeling (\d+)–(\d+) of (\d+)…$/, m => `正在標註第 ${m[1]}–${m[2]} 張，共 ${m[3]} 張…`],
      [/^Exporting (\d+)\/(\d+) · (.+)$/, m => `正在匯出 ${m[1]}/${m[2]} · ${m[3]}`],
      [/^Epoch (\d+)\/(\d+) · loss ([\d.eE+-]+)$/, m => `第 ${m[1]}/${m[2]} 輪 · 損失 ${m[3]}`],
      [/^Downloading model files · (\d+)\/(\d+)$/, m => `正在下載模型檔案 · ${m[1]}/${m[2]}`],
      [/^Downloading \/ loading (.+) · (.+)\. First load downloads model weights\.$/, m => `正在下載／載入 ${m[1]} · ${m[2]}，首次使用會下載權重。`],
      [/^VRAM limit reached\. Retrying with batch size (\d+)\.$/, m => `顯示記憶體不足，正在以批次大小 ${m[1]} 重試。`],
      [/^Request failed \((\d+)\)$/, m => `請求失敗（${m[1]}）`],
      [/^Native · (.+)$/, m => `原生 · ${m[1]}`],
      [/^Q4 · NF4 double quantization$/, () => 'Q4 · NF4 雙重量化'],
      [/^FP8 · (CUDA fused decode|CUDA scaled GEMM|weight-only) · (\d+) layers$/, m => `FP8 · ${({'CUDA fused decode':'CUDA 融合解碼','CUDA scaled GEMM':'CUDA 矩陣運算','weight-only':'僅權重量化'})[m[1]]} · ${m[2]} 層`],
      [/^Invalid (.+)\.$/, m => `${({model:'模型',quantization:'量化方式',resize:'圖片尺寸','YOLO training model':'YOLO 訓練模型'})[m[1]] || m[1]}無效。`],
      [/^(.+) must be an integer between (\d+) and (\d+)\.$/, m => `${({batch_size:'推論批次大小',max_tokens:'輸出 Token 上限',max_pixels:'視覺像素上限',epochs:'訓練輪數',train_imgsz:'訓練圖片尺寸',train_batch:'訓練批次大小',seed:'隨機種子'})[m[1]] || m[1]}必須是 ${m[2]} 至 ${m[3]} 之間的整數。`],
    ];
    for (const [regex, format] of patterns) { const match = value.match(regex); if (match) return format(match); }
    return value;
  }
  function capture() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest('script,style,textarea')) continue;
      const source = normalize(node.nodeValue);
      if (Object.hasOwn(zh, source)) nodes.push({node, source, before: node.nodeValue.match(/^\s*/)[0], after: node.nodeValue.match(/\s*$/)[0]});
    }
    for (const element of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')) {
      for (const name of ['title', 'aria-label', 'placeholder', 'alt']) {
        const source = element.getAttribute(name);
        if (source && Object.hasOwn(zh, source)) attributes.push({element, name, source});
      }
    }
  }
  function apply() {
    document.documentElement.lang = locale;
    document.title = t('Axiom — YOLO Auto Label');
    for (const record of nodes) if (record.node.isConnected) record.node.nodeValue = record.before + t(record.source) + record.after;
    for (const record of attributes) if (record.element.isConnected) record.element.setAttribute(record.name, t(record.source));
    document.getElementById('language-select').value = locale;
  }
  function setLocale(next) {
    locale = next === 'zh-TW' ? 'zh-TW' : 'en';
    try { localStorage.setItem('axiom.language', locale); } catch (_) {}
    apply();
    document.dispatchEvent(new CustomEvent('axiom-language-change'));
  }
  capture(); apply();
  document.getElementById('language-select').addEventListener('change', event => setLocale(event.target.value));
  return {t, message, apply, setLocale, get locale() { return locale; }, keys: Object.keys(zh)};
})();
