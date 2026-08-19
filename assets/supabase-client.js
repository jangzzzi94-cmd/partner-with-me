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
        .select("id, email, role, approval_status, points, nickname, name, created_at, cover_style_id")
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

/* ---- 아래 두 함수는 관리자 전용(admin.html)입니다 ---- */

// 관리자가 특정 회원에게 포인트를 지급한다(기존 값을 덮어쓰는 게 아니라 더해서 지급).
// DB 함수(admin_add_points)가 지급과 동시에 point_logs 테이블에 기록을 남기고,
// 호출한 사람이 관리자가 아니면 서버 쪽에서 거부한다.
async function adminAddPoints(userId, amount, note){
    const { data, error } = await supabaseClient.rpc("admin_add_points", {
        p_user_id: userId, p_amount: amount, p_note: note || null,
    });
    if(error) return { ok:false, message: error.message };
    return { ok:true, points: data };
}

// 포인트 지급/사용 로그를 최신순으로 가져온다(point_logs 테이블, RLS로 관리자만 조회 가능).
async function getPointLogs(limit){
    const { data, error } = await supabaseClient
        .from("point_logs")
        .select("id, user_id, delta, reason, note, actor_id, created_at")
        .order("created_at", { ascending:false })
        .limit(limit || 200);
    if(error){
        console.error(error);
        return [];
    }
    return data || [];
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

// 내 이름(실명)만 안전하게 저장한다. 별명과 별개 항목이며, 관리자 화면에서 별명 왼쪽에 표시된다.
async function updateMyName(name){
    const { error } = await supabaseClient.rpc("update_my_name", { p_name: name });
    if(error){
        console.error(error);
        return { ok:false, message: error.message };
    }
    return { ok:true };
}

async function adminDeleteAccount(userId){
    const { error } = await supabaseClient.rpc("admin_delete_account", { p_user_id: userId });
    if(error){
        console.error(error);
        return { ok:false, message: error.message };
    }
    return { ok:true };
}

async function deleteMyAccount(){
    const { error } = await supabaseClient.rpc("delete_my_account");
    if(error){
        console.error(error);
        return { ok:false, message: error.message };
    }
    // 계정이 서버에서 이미 삭제되었으므로, 브라우저에 남아있는 로그인 세션도 정리한다.
    try{ await supabaseClient.auth.signOut(); }catch(e){ /* 세션이 이미 무효화된 경우 무시 */ }
    return { ok:true };
}

/* =========================================================================
   보장분석표 "표지" 스타일 -- Storage 버킷 cover-images의 styles/<id>.png 사용,
   DB 테이블 cover_styles(id, name, image_path, name_x_ratio, name_y_ratio,
   is_default, sort_order)로 관리한다.
     - 관리자가 admin.html에서 스타일을 여러 개 등록해두고(각 스타일마다 이미지 +
       고객명 배지를 표시할 위치), 그 중 하나를 "기본 스타일"로 지정한다.
     - 회원은 profile.html에서 그 중 하나를 골라 쓰거나(profiles.cover_style_id),
       고르지 않으면 기본 스타일이 자동으로 적용된다.
   회원이 개인 이미지를 직접 올리던 이전 방식은 더 이상 사용하지 않는다.
   업로드된 원본 파일은 형식에 관계없이(jpg/png 등) 캔버스로 다시 그려 PNG로
   변환한 뒤 저장한다.
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

// Storage 경로를 공개 URL로 바꾼다. 관리자가 이미지를 교체해도 브라우저나 CDN에
// 캐시된 이전 이미지가 보이지 않도록 매번 캐시 무효화용 쿼리를 붙인다.
function getCoverImageUrl(path){
    const { data } = supabaseClient.storage.from("cover-images").getPublicUrl(path);
    return data.publicUrl + "?v=" + Math.floor(Date.now() / 1000);
}

// 등록된 표지 스타일 전체 목록을 가져온다(관리자 관리 화면 + 회원 선택 화면 공용).
async function getCoverStyles(){
    const { data, error } = await supabaseClient
        .from("cover_styles")
        .select("id, name, image_path, name_x_ratio, name_y_ratio, is_default, sort_order, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
    if(error){
        console.error(error);
        return [];
    }
    return data || [];
}

// profile(=getMyProfile() 결과)을 받아 지금 적용될 표지 스타일 행을 반환한다.
// 회원이 고른 스타일(cover_style_id)이 있으면 그것을, 없으면(또는 그 스타일이
// 삭제되어 더 없으면) 관리자가 지정한 기본 스타일을 반환한다. 관리자가 스타일을
// 하나도 등록하지 않았다면 null을 반환한다.
async function getMyEffectiveCoverStyle(profile){
    if(profile && profile.cover_style_id){
        const { data, error } = await supabaseClient
            .from("cover_styles")
            .select("id, name, image_path, name_x_ratio, name_y_ratio, is_default")
            .eq("id", profile.cover_style_id)
            .maybeSingle();
        if(!error && data) return data;
    }
    const { data, error } = await supabaseClient
        .from("cover_styles")
        .select("id, name, image_path, name_x_ratio, name_y_ratio, is_default")
        .eq("is_default", true)
        .maybeSingle();
    if(error){
        console.error(error);
        return null;
    }
    return data || null;
}

// 회원 본인이 사용할 표지 스타일을 고른다. styleId를 null로 주면 선택을 해제하고
// 관리자의 기본 스타일을 다시 따르게 된다.
async function updateMyCoverStyle(styleId){
    const { error } = await supabaseClient.rpc("update_my_cover_style", { p_style_id: styleId });
    if(error) return { ok:false, message: error.message };
    return { ok:true };
}

/* ---- 아래는 관리자 전용(admin.html) ---- */

// 새 스타일 이미지를 Storage에 올린다(styles/<uuid>.png). 실제 cover_styles 행 생성은
// createCoverStyle에서 같은 id로 한 번에 처리한다.
async function uploadCoverStyleImage(styleId, file){
    const blob = await fileToPngBlob(file, 1600);
    const path = "styles/" + styleId + ".png";
    const { error } = await supabaseClient.storage
        .from("cover-images")
        .upload(path, blob, { upsert:true, contentType:"image/png" });
    if(error) throw new Error(error.message);
    return path;
}

// 새 표지 스타일을 등록한다(이미지 업로드 + cover_styles 행 생성을 한 번에 처리).
async function createCoverStyle(name, file, nameXRatio, nameYRatio){
    try{
        const styleId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2)));
        const path = await uploadCoverStyleImage(styleId, file);
        const { data: existing } = await supabaseClient.from("cover_styles").select("id");
        const isFirst = !existing || existing.length === 0;
        const { error } = await supabaseClient.from("cover_styles").insert({
            id: styleId,
            name: name,
            image_path: path,
            name_x_ratio: nameXRatio,
            name_y_ratio: nameYRatio,
            is_default: isFirst, // 첫 스타일은 자동으로 기본 스타일로 지정
        });
        if(error) return { ok:false, message: error.message };
        return { ok:true, id: styleId };
    }catch(err){
        return { ok:false, message: err.message };
    }
}

// 기존 스타일의 이름/고객명 배지 위치를 수정한다. changes에는 { name?, name_x_ratio?, name_y_ratio? }.
async function updateCoverStyle(styleId, changes){
    const { error } = await supabaseClient.from("cover_styles").update(changes).eq("id", styleId);
    if(error) return { ok:false, message: error.message };
    return { ok:true };
}

// 스타일을 삭제한다(Storage의 이미지 파일도 함께 지운다).
async function deleteCoverStyle(styleId){
    await supabaseClient.storage.from("cover-images").remove(["styles/" + styleId + ".png"]);
    const { error } = await supabaseClient.from("cover_styles").delete().eq("id", styleId);
    if(error) return { ok:false, message: error.message };
    return { ok:true };
}

// 주어진 스타일을 "기본 스타일"로 지정한다(다른 스타일의 기본 지정은 자동으로 해제됨).
async function setDefaultCoverStyle(styleId){
    const { error } = await supabaseClient.rpc("set_default_cover_style", { p_style_id: styleId });
    if(error) return { ok:false, message: error.message };
    return { ok:true };
}
