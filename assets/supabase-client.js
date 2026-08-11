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
        .select("id, email, role, approval_status, points")
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
