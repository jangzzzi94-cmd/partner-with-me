/* =========================================================================
   보장분석표 엑셀 "표지" 시트 만들기 -- coverage.html(엑셀 다운로드)과
   customers.html(고객리스트에 저장해 둔 엑셀 내려받기)이 같이 쓴다.
   고객리스트에는 용량을 줄이려고 표지 없이 저장하고, 내려받을 때 이 코드로 표지를 붙인다.
   필요: ExcelJS, assets/supabase-client.js(getMyEffectiveCoverStyle, getCoverImageUrl)
   ========================================================================= */
(function(){
const COVER_MM_TO_PT = 2.834645669;
const COVER_PT_TO_PX = 96 / 72;
const COVER_A4_W_MM = 297; // 가로(landscape)
const COVER_A4_H_MM = 210;
const COVER_TARGET_PT_W = COVER_A4_W_MM * COVER_MM_TO_PT;
const COVER_TARGET_PT_H = COVER_A4_H_MM * COVER_MM_TO_PT;
const COVER_TARGET_PX_W = Math.round(COVER_TARGET_PT_W / 0.75);
const COVER_TARGET_PX_H = Math.round(COVER_TARGET_PT_H * COVER_PT_TO_PX);
const COVER_NAME_FONT_NAME = "Malgun Gothic";

// 고객명 텍스트 -- 박스/배지 없이 이미지 위에 바로 그린다. 글자 크기는 기본값에서
// 시작해 이름이 길면 COVER_NAME_MAX_WIDTH_RATIO(전체 너비 대비)를 넘지 않도록
// 자동으로 줄어든다. 어떤 사진 위에서도 읽히도록 흰 글자 + 옅은 어두운 외곽선을 쓴다.
const COVER_NAME_FONT_SIZE_PT = 26;
const COVER_NAME_MAX_WIDTH_RATIO = 0.6;
const COVER_NAME_MARGIN_PX = 24; // 이미지 가장자리에서 최소 이만큼은 띄운다
const COVER_NAME_FILL_COLOR = "#FFFFFF";
const COVER_NAME_STROKE_COLOR = "rgba(0,0,0,0.55)";

// Excel/LibreOffice가 허용하는 단일 행의 최대 높이(대략 400~409pt)보다 안전하게 낮은 값.
// 표지 한 장 전체 높이(COVER_TARGET_PT_H, 약 595pt)가 이 한도를 넘기 때문에, 행 하나로
// 만들면 Excel이 높이를 조용히 잘라버려 인쇄 배치가 깨진다. 그래서 넘는 만큼은 자동으로
// 여러 행으로 쪼갠다(splitSegment). 이미지는 그 행들 전체에 걸쳐 하나로 앉힌다.
const COVER_MAX_ROW_PT = 380;

function loadImageEl(url){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=> resolve(img);
    img.onerror = ()=> reject(new Error("표지 이미지를 불러오지 못했습니다."));
    img.src = url;
  });
}

// 이름이 너무 길면 maxWidthPx를 넘지 않을 때까지 글자 크기를 1px씩 줄인다.
function fitCoverNameFont(ctx, text, maxWidthPx, basePx){
  let size = basePx;
  ctx.font = `bold ${size}px "${COVER_NAME_FONT_NAME}", sans-serif`;
  while(size > 10 && ctx.measureText(text).width > maxWidthPx){
    size -= 1;
    ctx.font = `bold ${size}px "${COVER_NAME_FONT_NAME}", sans-serif`;
  }
  return size;
}

// customerName 뒤에 "님"이 없으면 붙인다(표지 전용 표기 -- 다른 시트의 고객명에는
// 적용하지 않는다).
function withNimSuffix(name){
  const trimmed = (name || "").trim();
  if(!trimmed) return trimmed;
  return /님$/.test(trimmed) ? trimmed : trimmed + "님";
}

// 표지 이미지를 A4 가로 크기(px)에 꽉 차게 그리고, nameText가 있으면 nameXRatio/
// nameYRatio(전체 이미지 대비 0~1 비율) 위치에 배경 없이 텍스트만 그려 넣는다.
async function buildCoverImageBuffer(imgUrl, nameText, nameXRatio, nameYRatio){
  const img = await loadImageEl(imgUrl);
  const canvas = document.createElement("canvas");
  canvas.width = COVER_TARGET_PX_W;
  canvas.height = COVER_TARGET_PX_H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, COVER_TARGET_PX_W, COVER_TARGET_PX_H);

  if(nameText){
    const basePx = COVER_NAME_FONT_SIZE_PT * COVER_PT_TO_PX;
    const maxWidthPx = COVER_NAME_MAX_WIDTH_RATIO * COVER_TARGET_PX_W;
    const fontPx = fitCoverNameFont(ctx, nameText, maxWidthPx, basePx);
    ctx.font = `bold ${fontPx}px "${COVER_NAME_FONT_NAME}", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, Math.round(fontPx * 0.12));

    const textWidthPx = ctx.measureText(nameText).width;
    const halfW = textWidthPx / 2 + COVER_NAME_MARGIN_PX;
    const halfH = fontPx / 2 + COVER_NAME_MARGIN_PX;
    const cx = Math.max(halfW, Math.min(COVER_TARGET_PX_W - halfW, nameXRatio * COVER_TARGET_PX_W));
    const cy = Math.max(halfH, Math.min(COVER_TARGET_PX_H - halfH, nameYRatio * COVER_TARGET_PX_H));

    ctx.strokeStyle = COVER_NAME_STROKE_COLOR;
    ctx.strokeText(nameText, cx, cy);
    ctx.fillStyle = COVER_NAME_FILL_COLOR;
    ctx.fillText(nameText, cx, cy);
  }

  const blob = await new Promise((resolve, reject)=>{
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("표지 이미지 생성에 실패했습니다.")), "image/png");
  });
  return blob.arrayBuffer();
}

// 길이(size)가 maxSize를 넘으면 넘지 않는 여러 개의 동일한 조각으로 쪼갠다. size가
// 거의 0이면 빈 배열.
function splitSegment(size, maxSize){
  if(size <= 0.5) return [];
  if(!maxSize || size <= maxSize) return [size];
  const n = Math.ceil(size / maxSize);
  const each = size / n;
  return Array(n).fill(each);
}

// wb의 기존 "표지" 시트를 통째로 지우고, A4 가로에 꽉 차는 이미지 시트로 교체한다.
// 항상 첫 번째 시트 자리를 유지한다.
async function replaceCoverSheetWithImage(wb, customerName, profile, opts){
  const oldWs = wb.getWorksheet("표지");
  // 혹시 템플릿에 표지 시트가 없으면 건드리지 않는다.
  // (opts.addIfMissing: 고객리스트에 표지 없이 저장해 둔 엑셀을 내려받을 때 표지를 새로 붙인다)
  if(!oldWs && !(opts && opts.addIfMissing)) return false;

  const style = (opts && opts.style !== undefined) ? opts.style : await getMyEffectiveCoverStyle(profile);
  if(!style) return false; // 관리자가 아직 스타일을 하나도 등록하지 않았다면 템플릿 표지를 그대로 둔다.

  const nameText = withNimSuffix(customerName);
  const imageArrayBuffer = await buildCoverImageBuffer(
    getCoverImageUrl(style.image_path),
    nameText,
    Number(style.name_x_ratio),
    Number(style.name_y_ratio)
  );

  if(oldWs) wb.removeWorksheet(oldWs.id);
  const ws = wb.addWorksheet("표지", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      margins: { left:0, right:0, top:0, bottom:0, header:0, footer:0 },
      // 여러 방식을 시도했지만(행 높이를 A4 실제 크기에 딱 맞추기, fitToWidth/fitToHeight를
      // 0 또는 아예 생략하기 등) 실제 Microsoft Excel에서는 계속 "인쇄 영역"(실선)과 실제
      // 페이지 나누기 미리보기의 "점선"이 어긋나는 문제가 있었다 -- 프린터마다 다른 인쇄 불가
      // 여백을 안전하게 예측할 방법이 없기 때문으로 보인다. 그래서 우리가 직접 크기를 딱 맞추는
      // 대신, 엑셀 자체의 "한 페이지에 맞춤" 기능(페이지 설정 대화상자의 "확대/축소" 대신
      // "다음 크기에 맞게 페이지 조정: 가로 1 x 세로 1")을 명시적으로 켠다. 이러면 실제 프린터의
      // 여백이 얼마이든 상관없이 엑셀이 알아서 필요한 만큼만(거의 100%에 가깝게) 살짝 축소해서
      // 반드시 정확히 1페이지 안에 들어가도록 계산해준다 -- 우리가 프린터 여백을 추측할 필요가
      // 없어진다. sheetPr/pageSetUpPr에 fitToPage="1"이 함께 저장돼야 이 모드가 확실히
      // 켜지므로 fitToPage: true를 반드시 같이 지정한다(예전에 fitToWidth/fitToHeight만
      // 1로 남고 이 플래그가 빠져서 애매하게 해석되던 문제와는 다른 경우).
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      verticalCentered: true,
    }
  });

  // 시트 표시 순서(orderNo)는 workbook.worksheets 게터가 매번 orderNo로 정렬해
  // 새로 계산하므로, 기존 시트들 중 가장 작은 orderNo보다 작게 지정해야 맨 앞에 온다.
  const otherOrderNos = wb.worksheets.filter(w => w !== ws).map(w => w.orderNo);
  ws.orderNo = (otherOrderNos.length ? Math.min(...otherOrderNos) : 1) - 1;

  // 엑셀에서 이 시트를 열었을 때 처음부터 "페이지 나누기 미리보기"로 보이도록 한다(실선=인쇄
  // 영역, 점선=실제 페이지 구분선이 한눈에 같은지 바로 확인할 수 있도록).
  ws.views = [{ style: "pageBreakPreview" }];

  const MDW = 7; // Calibri 11 기준 Maximum Digit Width
  const pxToChars = (px)=> (px * 256 / MDW - Math.floor(128 / MDW)) / 256;

  // 참고: 이미지를 oneCellAnchor(셀 하나에 고정 픽셀 크기로 앉히는 방식)로 넣으면 -- 심지어
  // 다른 셀에 아무 값도 없는 예전 방식(이미지만 있는 A1:A2)에서도 -- 로컬 LibreOffice 인쇄/PDF
  // 변환 시 표지 시트 하나가 페이지 2개로 잘못 쪼개지는 현상이 있었다(실제 사용자가 받은
  // 파일로도 재현 확인: 인쇄하면 이미지 맨 위 몇 픽셀만 다음 페이지에 걸쳐 나옴 -- "인쇄 영역이
  // 꽉 차지 않고 정중앙도 아니다"라는 원래 문제의 실제 원인으로 보인다). 이미지 크기를 셀 격자
  // 경계에서 직접 계산하는 twoCellAnchor(tl~br)로 바꾸면 이 분할이 재현되지 않아 이 방식으로
  // 통일한다. 열은 한 칸이면 충분하지만(열 너비 최대치에 훨씬 못 미침), 행은 표지 전체
  // 높이가 Excel의 단일 행 높이 한도를 넘으므로 여러 행으로 쪼갠다(splitSegment).
  const rowHeightsPt = splitSegment(COVER_TARGET_PT_H, COVER_MAX_ROW_PT);
  ws.getColumn(1).width = pxToChars(COVER_TARGET_PX_W);
  rowHeightsPt.forEach((pt, i)=>{ ws.getRow(i + 1).height = pt; });

  const totalRows = rowHeightsPt.length;
  ws.pageSetup.printArea = `A1:A${totalRows}`;

  const imgId = wb.addImage({ buffer: imageArrayBuffer, extension: "png" });
  ws.addImage(imgId, {
    tl: { col: 0, row: 0 },
    br: { col: 1, row: totalRows },
    editAs: "twoCell",
  });
  return true;
}

// 시트를 지워도 ExcelJS는 그 시트가 쓰던 그림(표지 약 0.5MB)을 파일에 그대로 남긴다.
// 아무 시트도 안 쓰는 그림은 1x1 투명 그림으로 바꿔서 용량만 줄인다(번호는 그대로 둬야 다른 그림이 안 깨짐).
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
function dropUnusedMedia(wb){
  const media = (wb.model && wb.model.media) || wb.media || [];
  const used = new Set();
  wb.worksheets.forEach(ws => { (ws.getImages ? ws.getImages() : []).forEach(im => used.add(Number(im.imageId))); if(ws.model && ws.model.background && ws.model.background.imageId != null) used.add(Number(ws.model.background.imageId)); });
  let bin = null;
  media.forEach((m, i) => {
    if(used.has(i) || !m || m.type !== "image") return;
    if(!bin){ const s = atob(TINY_PNG_B64); bin = new Uint8Array(s.length); for(let k = 0; k < s.length; k++) bin[k] = s.charCodeAt(k); }
    m.buffer = bin; m.extension = "png"; delete m.base64; delete m.filename;
  });
}

window.WPCover = {
  replaceCoverSheetWithImage: replaceCoverSheetWithImage,
  dropUnusedMedia: dropUnusedMedia,
  withNimSuffix: withNimSuffix
};
})();
