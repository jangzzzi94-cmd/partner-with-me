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
