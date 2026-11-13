/* 출근보고 미제출 알림 (웹푸시)
   attendance.html 에서  <script src="assets/attendance-push.js" defer></script>  로 불러옵니다. */
(function(){
  "use strict";
  var VAPID_PUBLIC = "BH-GRu47RaUZPMmHK8icjJe66POf0umwvGSIk4yTXHfNGWX7rU16Yp50p8uLeN0ohAOrRb7XNaFE9N6rEGjbruE";
  var AUTH_LS_KEY  = "sb-njtibtadrzayerkpevep-auth-token";

  (function(){ if(document.getElementById("pnCSS")) return;
    var st=document.createElement("style"); st.id="pnCSS"; st.textContent="#pnBox{margin:10px 0 0;padding:12px 14px;border-radius:14px;background:#fff;border:1px solid #e6e9ef;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:#5b6476}#pnBox .pn-t{font-weight:700;color:#171b23}#pnBtn{margin-left:auto;padding:9px 14px;border-radius:10px;border:0;cursor:pointer;background:#2f6bff;color:#fff;font-weight:700;font-size:13.5px}#pnBtn[disabled]{opacity:.55;cursor:default}#pnBtn.off{background:#eef1f6;color:#5b6476}#pnHelp{flex-basis:100%;font-size:12px;color:#7a8498;line-height:1.55}#pnDraft{margin:0 0 10px;padding:12px 14px;border-radius:14px;background:#fff1f1;border:1px solid #ffccd0;color:#9f1220;font-size:13px;line-height:1.55}#pnDraft b{color:#7a0d18}";
    document.head.appendChild(st); })();
  var CFG = null;

  function b64ToU8(b64){
    var pad = "=".repeat((4 - b64.length % 4) % 4);
    var s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function session(){
    try { return JSON.parse(localStorage.getItem(AUTH_LS_KEY) || "null"); } catch (e) { return null; }
  }
  async function cfg(){
    if (CFG) return CFG;
    var t = await (await fetch("assets/supabase-client.js", { cache: "no-store" })).text();
    var url = (t.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
    var key = (t.match(/sb_publishable_[A-Za-z0-9_\-]{10,}/) ||
               t.match(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}/) || [])[0];
    if (!url || !key) throw new Error("supabase 설정을 찾지 못했습니다");
    CFG = { url: url, key: key };
    return CFG;
  }
  async function api(path, init){
    var c = await cfg(), s = session();
    init = init || {};
    var r = await fetch(c.url + "/rest/v1/" + path, Object.assign({}, init, {
      headers: Object.assign({
        apikey: c.key,
        Authorization: "Bearer " + ((s && s.access_token) || c.key),
        "Content-Type": "application/json",
        Accept: "application/json"
      }, init.headers || {})
    }));
    var txt = await r.text();
    if (!r.ok) throw new Error(path + " " + r.status + " " + txt.slice(0, 200));
    return txt ? JSON.parse(txt) : null;
  }

  var iosLike = /iPad|iPhone|iPod/.test(navigator.platform || "") ||
                (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ""));
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function supported(){ return ("serviceWorker" in navigator) && ("PushManager" in window) && (typeof Notification !== "undefined"); }

  async function currentSub(){
    if (!supported()) return null;
    var reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  }

  async function enable(){
    if (!supported()) throw new Error("이 브라우저는 알림을 지원하지 않습니다");
    if (iosLike && !standalone) throw new Error("ios-install");
    var perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.");
    var reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC) });
    var j = sub.toJSON(), s = session();
    var uid = s && s.user && s.user.id;
    if (!uid) throw new Error("로그인 정보를 확인할 수 없습니다");
    await api("attendance_push_subs?on_conflict=endpoint", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        endpoint: j.endpoint, uid: uid,
        p256dh: j.keys.p256dh, auth: j.keys.auth,
        label: (standalone ? "앱" : "브라우저")
      })
    });
    return true;
  }

  async function disable(){
    var sub = await currentSub();
    if (sub) {
      try { await api("attendance_push_subs?endpoint=eq." + encodeURIComponent(sub.endpoint), { method: "DELETE" }); } catch (e) {}
      try { await sub.unsubscribe(); } catch (e) {}
    }
  }

  function box(){
    var el = document.getElementById("pnBox");
    if (el) return el;
    el = document.createElement("div");
    el.id = "pnBox";
    el.innerHTML = '<span class="pn-t">🔔 마감 알림</span>' +
                   '<span id="pnState">확인 중…</span>' +
                   '<button type="button" id="pnBtn" disabled>…</button>' +
                   '<span id="pnHelp"></span>';
    return el;
  }

  async function paint(){
    var el = document.getElementById("pnBox");
    if (!el) return;
    var st = el.querySelector("#pnState"), btn = el.querySelector("#pnBtn"), help = el.querySelector("#pnHelp");
    if (!supported()) {
      st.textContent = "이 브라우저는 지원하지 않습니다";
      btn.style.display = "none"; help.textContent = "크롬 또는 사파리에서 열어주세요."; return;
    }
    if (iosLike && !standalone) {
      st.textContent = "아이폰은 홈 화면에 추가해야 알림이 옵니다";
      btn.style.display = "none";
      help.textContent = "사파리 하단 공유( ↑ ) → '홈 화면에 추가' → 추가된 아이콘으로 다시 열고 이 버튼을 눌러주세요. (1회만 하면 됩니다)";
      return;
    }
    if (Notification.permission === "denied") {
      st.textContent = "알림이 차단되어 있습니다";
      btn.style.display = "none";
      help.textContent = "브라우저 주소창의 자물쇠 → 알림 → 허용 으로 바꿔주세요.";
      return;
    }
    var sub = await currentSub();
    btn.disabled = false; btn.style.display = "";
    if (sub) {
      st.textContent = "켜짐 · 20:00 / 21:30 에 남은 항목을 알려드립니다";
      btn.textContent = "끄기"; btn.className = "off";
      btn.onclick = async function(){ btn.disabled = true; try { await disable(); } catch (e) {} await paint(); };
      help.textContent = "";
    } else {
      st.textContent = "꺼짐 · 마감 전에 알림을 받으려면 켜주세요";
      btn.textContent = "알림 켜기"; btn.className = "";
      btn.onclick = async function(){
        btn.disabled = true; btn.textContent = "설정 중…";
        try {
          await enable();
          try { (await navigator.serviceWorker.getRegistration("/")).showNotification("알림이 켜졌습니다", { body: "출근보고·워킹사진·일마감 중 남은 게 있으면 20:00 / 21:30 에 알려드립니다.", icon: "/icon-192.png", tag: "pn-test" }); } catch (e) {}
        } catch (e) {
          if (String(e.message) !== "ios-install") alert(e.message || e);
        }
        await paint();
      };
      help.textContent = "";
    }
  }

  // 보고 탭 배너에서 대상일 파싱 → 작성중(미제출) 경고
  // 보고 탭의 "2026.11.16 (월)" 배너를 찾는다 (.banner.i 가 여러 개일 수 있음)
  function reportBanner(){
    var list = document.querySelectorAll(".banner.i");
    for (var i = 0; i < list.length; i++) {
      if (/\d{4}\.\d{2}\.\d{2}/.test(list[i].textContent || "")) return list[i];
    }
    return null;
  }
  function targetDate(){
    var b = reportBanner();
    var m = b && b.textContent.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : null;
  }
  var lastWarn = { date: null, at: 0, show: false };
  async function draftWarn(fallbackAnchor){
    var d = targetDate(), s = session();
    var uid = s && s.user && s.user.id;
    var old = document.getElementById("pnDraft");
    if (!d || !uid) { if (old) old.remove(); return; }

    var fresh = (lastWarn.date === d) && (Date.now() - lastWarn.at < 60000);
    if (!fresh) {
      var rows = null;
      try { rows = await api("attendance_daily?select=data&uid=eq." + uid + "&date=eq." + d); } catch (e) { return; }
      var v = (rows && rows[0] && rows[0].data) || null;
      var show = !!(v && !v.reportAt &&
                    (v.type || v.reason || v.reasonPhoto || v.gaejikPhoto ||
                     (Array.isArray(v.photos) && v.photos.length)));
      lastWarn = { date: d, at: Date.now(), show: show };
    }
    if (!lastWarn.show) { if (old) old.remove(); return; }
    if (old) return;

    var el = document.createElement("div");
    el.id = "pnDraft";
    el.innerHTML = "\u26a0\ufe0f <b>\uc544\uc9c1 \uc81c\ucd9c\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.</b> " +
                   d.slice(5).replace("-", "/") +
                   " \ubcf4\uace0\ub97c \uc4f0\ub2e4\uac00 \uc911\ub2e8\ub41c \uc0c1\ud0dc\uc785\ub2c8\ub2e4 (\uc99d\ube59\ub9cc \uc62c\ub77c\uac10). " +
                   "\uc544\ub798 <b>\u2018\ubcf4\uace0 \uc81c\ucd9c\u2019</b> \ubc84\ud2bc\uc744 \ub20c\ub7ec\uc57c \uc811\uc218\ub429\ub2c8\ub2e4.";
    var save = document.getElementById("rSave");
    if (save && save.parentNode) save.parentNode.insertBefore(el, save);
    else if (fallbackAnchor && fallbackAnchor.parentNode) fallbackAnchor.parentNode.insertBefore(el, fallbackAnchor.nextSibling);
  }

  function mount(){
    var banner = reportBanner();
    if (!banner) return;
    if (!document.getElementById("pnBox")) {
      banner.parentNode.insertBefore(box(), banner.nextSibling);
      paint();
    }
    draftWarn(document.getElementById("pnBox") || banner);
  }

  var tm = null;
  new MutationObserver(function(){ clearTimeout(tm); tm = setTimeout(mount, 150); })
    .observe(document.body, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  // 이미 켜둔 사람은 서비스워커를 항상 최신으로 유지
  if (supported() && Notification.permission === "granted") {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function(){});
  }
})();
