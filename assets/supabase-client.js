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
        .select("id, email, role, approval_status, points, nickname, created_at")
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
