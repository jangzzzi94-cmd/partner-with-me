const SUPABASE_URL = "https://njtibtadrzayerkpevep.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uL6-M0dJ5m1EXFNl0cWkqw_QTHTj-DC";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function requireLogin(){
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if(!session){
        window.location.href = "login.html";
        return null;
    }
    return session;
}

async function logout(){
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
}

async function getMyProfile(){
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if(!session) return null;
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, email, role, approval_status, points, nickname, created_at, cover_image_path")
        .eq("id", session.user.id)
        .single();
    if(error){
        console.error(error);
        return null;
    }
    return data;
}

async function requireAdmin(){
    const session = await requireLogin();
    if(!session) return null;
    const profile = await getMyProfile();
    if(!profile || profile.role !== "admin"){
        window.location.href = "dashboard.html";
        return null;
    }
    return profile;
}

async function spendPoints(feature){
    const { data, error } = await supabaseClient.rpc("spend_points", { p_feature: feature });
    if(error){
        console.error(error);
        return false;
    }
    return data === true;
}

// 기능별 1회 이용 시 차감되는 포인트를 DB(point_costs 테이블, 관리자가 admin.html에서 수정)에서
// 읽어온다. 조회에 실패하면(테이블이 아직 없거나 네트워크 오류 등) 화면이 깨지지 않도록
// 기존 기본값(병력정리 1,000P / 보장분석표 3,000P)으로 대신한다.
async function getPointCosts(){
    const defaults = { history: 1000, coverage: 3000 };
    const { data, error } = await supabaseClient.from("point_costs").select("feature, cost");
    if(error || !data){
        console.error(error);
        return defaults;
    }
    const map = Object.assign({}, defaults);
    data.forEach(function(r){ map[r.feature] = r.cost; });
    return map;
}

// 내 별명(닉네임)만 안전하게 저장한다 (등급/포인트 등 다른 항목은 이 함수로 바꿀 수 없음).
async function updateMyNickname(nickname){
    const { error } = await supabaseClient.rpc("update_my_nickname", { p_nickname: nickname });
    if(error){
        console.error(error);
        return { ok:false, message: error.message };
    }
    return { ok:true };
}

/* =========================================================================
   보장분석표 "표지" 이미지 -- Storage 버킷 cover-images 사용.
     - default/cover.png       : 관리자가 admin.html에서 설정하는 기본 표지 이미지
     - users/<uid>/cover.png   : 회원이 profile.html에서 직접 올린 개인 표지 이미지
   profiles.cover_image_path가 NULL이면 기본 이미지를, 값이 있으면 그 경로의
   개인 이미지를 사용한다. 업로드된 원본 파일은 형식에 관계없이(jpg/png 등)
   캔버스로 다시 그려 PNG로 변환한 뒤 저장한다(형식 통일 + 파일명 고정으로
   재업로드 시 이전 파일을 자연스럽게 덮어쓰기 위함).
   ========================================================================= */
function loadImageFromFile(file){
    return new Promise(function(resolve, reject){
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function(){ URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("이미지 파일을 읽을 수 없습니다.")); };
        img.src = url;
    });
}

// 업로드한 이미지를 캔버스에 그려 PNG Blob으로 변환한다. 용량이 지나치게 커지지
// 않도록 긴 변 기준 maxSize를 넘으면 비율을 유지한 채 축소한다.
async function fileToPngBlob(file, maxSize){
    const img = await loadImageFromFile(file);
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if(!w0 || !h0) throw new Error("이미지 크기를 확인할 수 없습니다.");
    const scale = Math.min(1, (maxSize || 1600) / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return new Promise(function(resolve, reject){
        canvas.toBlob(function(blob){
            if(blob) resolve(blob); else reject(new Error("이미지 변환에 실패했습니다."));
        }, "image/png");
    });
}

// profile(=getMyProfile() 결과)을 받아 지금 적용될 표지 이미지의 Storage 경로를 반환한다.
function getEffectiveCoverImagePath(profile){
    return (profile && profile.cover_image_path) ? profile.cover_image_path : "default/cover.png";
}

// Storage 경로를 공개 URL로 바꾼다. 관리자/회원이 이미지를 교체해도 브라우저나 CDN에
// 캐시된 이전 이미지가 보이지 않도록 매번 캐시 무효화용 쿼리를 붙인다.
function getCoverImageUrl(path){
    const { data } = supabaseClient.storage.from("cover-images").getPublicUrl(path);
    return data.publicUrl + "?v=" + Math.floor(Date.now() / 1000);
}

// 회원 본인의 표지 이미지를 업로드하고, profiles.cover_image_path를 그 경로로 갱신한다.
async function uploadMyCoverImage(file){
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if(!session) return { ok:false, message:"로그인이 필요합니다." };
    try{
        const blob = await fileToPngBlob(file, 1600);
        const path = "users/" + session.user.id + "/cover.png";
        const { error: uploadError } = await supabaseClient.storage
            .from("cover-images")
            .upload(path, blob, { upsert:true, contentType:"image/png" });
        if(uploadError) return { ok:false, message: uploadError.message };
        const { error: rpcError } = await supabaseClient.rpc("update_my_cover_image_path", { p_path: path });
        if(rpcError) return { ok:false, message: rpcError.message };
        return { ok:true, path: path };
    }catch(err){
        return { ok:false, message: err.message };
    }
}

// 회원이 올린 개인 표지 이미지를 지우고 관리자가 설정한 기본 이미지로 되돌린다.
async function resetMyCoverImage(){
    const { error } = await supabaseClient.rpc("update_my_cover_image_path", { p_path: null });
    if(error) return { ok:false, message: error.message };
    return { ok:true };
}

// (관리자 전용) 전체 회원의 기본 표지 이미지를 업로드/교체한다.
async function uploadDefaultCoverImage(file){
    try{
        const blob = await fileToPngBlob(file, 1600);
        const path = "default/cover.png";
        const { error: uploadError } = await supabaseClient.storage
            .from("cover-images")
            .upload(path, blob, { upsert:true, contentType:"image/png" });
        if(uploadError) return { ok:false, message: uploadError.message };
        return { ok:true, path: path };
    }catch(err){
        return { ok:false, message: err.message };
    }
}
