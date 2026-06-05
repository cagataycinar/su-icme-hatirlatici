import { useState, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, StatusBar, Platform,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import Svg, { Circle, Path, ClipPath, Defs, Rect, G, LinearGradient, Stop } from "react-native-svg";

const AMOUNTS = [150, 200, 250, 300, 500];
const DEFAULT_GOAL = 2000;
const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const THEMES = [
  { name: "Okyanus", a: "#185FA5", b: "#1D9E75", bg: "#e8f4fd", card: "#fff", border: "#c5dff7", ring: "#378ADD" },
  { name: "Gün Batımı", a: "#993556", b: "#BA7517", bg: "#fbeaf0", card: "#fff", border: "#f4c0d1", ring: "#D4537E" },
  { name: "Orman", a: "#3B6D11", b: "#0F6E56", bg: "#eaf3de", card: "#fff", border: "#c0dd97", ring: "#639922" },
  { name: "Lavanta", a: "#534AB7", b: "#993556", bg: "#EEEDFE", card: "#fff", border: "#CECBF6", ring: "#7F77DD" },
  { name: "Kömür", a: "#2C2C2A", b: "#185FA5", bg: "#e8e8e4", card: "#fff", border: "#D3D1C7", ring: "#444441" },
];

function fmt(ml) { return ml >= 1000 ? (ml / 1000).toFixed(1) + " L" : ml + " ml"; }
function timeStr(h, m) { return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
function hexA(hex, a) { return hex + a; }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

const STORAGE_KEY = "su_icme_data_v1";

function WaterRing({ pct, color }) {
  const size = 160, r = 72, cx = size / 2, cy = size / 2;
  const fillY = size - (pct / 100) * size;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <ClipPath id="cc"><Circle cx={cx} cy={cy} r={r} /></ClipPath>
        <LinearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.9" />
          <Stop offset="1" stopColor={color} stopOpacity="0.4" />
        </LinearGradient>
      </Defs>
      <G clipPath="url(#cc)">
        <Rect x="0" y={fillY} width={size} height={size} fill={hexA(color, "22")} />
        <Path
          d={`M0,${fillY} Q40,${fillY - 10} 80,${fillY} T160,${fillY} L160,${size} L0,${size} Z`}
          fill={hexA(color, "55")}
        />
      </G>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#rg)" strokeWidth="5" />
    </Svg>
  );
}

function BarChart({ data, color }) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 110, paddingHorizontal: 4 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontSize: 9, color, fontWeight: "700", marginBottom: 4, opacity: d.v > 0 ? 1 : 0 }}>
            {d.v > 0 ? fmt(d.v) : ""}
          </Text>
          <View style={{ width: "70%", height: 70, borderRadius: 6, backgroundColor: hexA(color, "22"), justifyContent: "flex-end", overflow: "hidden" }}>
            <View style={{ height: `${(d.v / max) * 100}%`, backgroundColor: color, borderRadius: 6 }} />
          </View>
          <Text style={{ fontSize: 10, color: "#888", fontWeight: "600", marginTop: 4 }}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <WaterApp />
    </SafeAreaProvider>
  );
}

function WaterApp() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState("home");
  const [themeIdx, setThemeIdx] = useState(0);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [intake, setIntake] = useState([]);
  const [weekData, setWeekData] = useState(Array(7).fill(0));
  const [reminders, setReminders] = useState([
    { id: 1, time: "08:00", active: true }, { id: 2, time: "10:00", active: true },
    { id: 3, time: "12:00", active: true }, { id: 4, time: "15:00", active: true },
    { id: 5, time: "18:00", active: true }, { id: 6, time: "21:00", active: true },
  ]);
  const [newH, setNewH] = useState(9);
  const [newM, setNewM] = useState(0);
  const [newGoal, setNewGoal] = useState(String(DEFAULT_GOAL));
  const [customMl, setCustomMl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savedDay, setSavedDay] = useState(todayKey());

  // Bildirim kurulumu
  const setupNotifications = async () => {
    try {
      // Android bildirim kanalı oluştur (zorunlu)
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("reminders", {
          name: "Su Hatırlatmaları",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#378ADD",
        });
      }
      // Kullanıcıdan izin iste
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") console.log("Bildirim izni verilmedi");
    } catch (e) { console.log("Bildirim kurulumu hatası", e); }
  };

  const scheduleReminders = async (reminders) => {
    try {
      // Eski bildirimleri temizle
      await Notifications.cancelAllScheduledNotificationsAsync();
      // Her aktif hatırlatma için günlük bildirim kur
      for (const r of reminders.filter(x => x.active)) {
        const [h, m] = r.time.split(":").map(Number);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "💧 Su İçme Vakti!",
            body: "Günlük hedefine ulaşman için su iç.",
            sound: "default",
            badge: 1,
          },
          trigger: {
            type: "daily",
            hour: h,
            minute: m,
            channelId: "reminders",
          },
        });
      }
    } catch (e) { console.log("Bildirimleri zamanlama hatası", e); }
  };

  // Uygulama açılınca kayıtlı verileri yükle
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (d.goal) { setGoal(d.goal); setNewGoal(String(d.goal)); }
          if (typeof d.themeIdx === "number") setThemeIdx(d.themeIdx);
          if (Array.isArray(d.reminders)) setReminders(d.reminders);
          if (Array.isArray(d.weekData)) setWeekData(d.weekData);
          // İçilen su sadece bugüne aitse yükle, yeni günse sıfırla
          if (d.day === todayKey() && Array.isArray(d.intake)) setIntake(d.intake);
          else setSavedDay(todayKey());
        }
      } catch (e) { console.log("Yükleme hatası", e); }
      setLoaded(true);
      await setupNotifications();
    })();
  }, []);

  // Veriler değişince otomatik kaydet
  useEffect(() => {
    if (!loaded) return;
    const data = { goal, themeIdx, reminders, weekData, intake, day: savedDay };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(e => console.log("Kayıt hatası", e));
  }, [goal, themeIdx, reminders, weekData, intake, savedDay, loaded]);

  // Hatırlatmalar değişince bildirimleri güncelle
  useEffect(() => {
    if (loaded) scheduleReminders(reminders);
  }, [reminders, loaded]);

  const theme = THEMES[themeIdx];
  const total = intake.reduce((s, e) => s + e.amount, 0);
  const pct = Math.min(100, Math.round((total / goal) * 100));
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

  function addWater(ml) {
    if (!ml || ml <= 0) return;
    const now = new Date();
    setIntake(prev => [...prev, { id: Date.now(), amount: ml, time: timeStr(now.getHours(), now.getMinutes()) }]);
    setWeekData(prev => { const n = [...prev]; n[todayIdx] += ml; return n; });
    setCustomMl("");
  }
  function removeEntry(id) {
    const entry = intake.find(e => e.id === id);
    if (entry) setWeekData(prev => { const n = [...prev]; n[todayIdx] = Math.max(0, n[todayIdx] - entry.amount); return n; });
    setIntake(prev => prev.filter(e => e.id !== id));
  }
  function toggleReminder(id) { setReminders(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r)); }
  function deleteReminder(id) { setReminders(prev => prev.filter(r => r.id !== id)); }
  function addReminder() {
    const t = timeStr(newH, newM);
    if (reminders.find(r => r.time === t)) return;
    setReminders(prev => [...prev, { id: Date.now(), time: t, active: true }].sort((a, b) => a.time.localeCompare(b.time)));
  }
  function saveGoal() { const v = parseInt(newGoal); if (!isNaN(v) && v > 0) setGoal(v); }

  const chartData = DAYS.map((label, i) => ({ label, v: weekData[i] }));
  const tabs = [
    { id: "home", icon: "💧", label: "Ana Sayfa" },
    { id: "stats", icon: "📊", label: "İstatistik" },
    { id: "reminders", icon: "🔔", label: "Hatırlatma" },
    { id: "settings", icon: "⚙️", label: "Ayarlar" },
  ];

  const label = (txt) => <Text style={[st.label, { color: theme.a }]}>{txt}</Text>;

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle="light-content" />
      {/* Header */}
      <View style={[st.header, { backgroundColor: theme.a }]}>
        <Text style={st.headerSub}>GÜNLÜK TAKİP</Text>
        <Text style={st.headerTitle}>Su İçme Hatırlatıcı 💧</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
        {/* HOME */}
        {tab === "home" && (
          <View>
            <View style={{ alignItems: "center", marginBottom: 20, position: "relative" }}>
              <WaterRing pct={pct} color={theme.ring} />
              <View style={st.ringCenter}>
                <Text style={{ fontSize: 30, fontWeight: "900", color: theme.a }}>{pct}%</Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.b, marginTop: 2 }}>{fmt(total)}</Text>
                <Text style={{ fontSize: 11, color: "#888" }}>/ {fmt(goal)}</Text>
              </View>
            </View>

            <View style={[st.card, { borderColor: theme.border, flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 16 }]}>
              <View style={{ flex: 1, height: 10, backgroundColor: hexA(theme.ring, "22"), borderRadius: 99, overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${pct}%`, backgroundColor: theme.a, borderRadius: 99 }} />
              </View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: theme.a, marginLeft: 12, width: 40, textAlign: "right" }}>{pct}%</Text>
            </View>

            {label("HIZLI EKLE")}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
              {AMOUNTS.map(ml => (
                <TouchableOpacity key={ml} onPress={() => addWater(ml)} activeOpacity={0.7}
                  style={[st.quickBtn, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={{ fontSize: 18 }}>💧</Text>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: theme.a }}>{ml}</Text>
                  <Text style={{ fontSize: 9, color: theme.b }}>ml</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[st.card, { borderColor: theme.border, flexDirection: "row", alignItems: "center", marginBottom: 16 }]}>
              <Text style={{ fontSize: 18, marginRight: 8 }}>✏️</Text>
              <TextInput value={customMl} onChangeText={setCustomMl} placeholder="Özel miktar (ml)" keyboardType="numeric"
                style={[st.input, { flex: 1, borderColor: theme.border, color: theme.a }]} placeholderTextColor="#aaa" />
              <TouchableOpacity onPress={() => addWater(parseInt(customMl))} style={[st.gradBtn, { backgroundColor: theme.a, marginLeft: 8 }]}>
                <Text style={st.gradBtnTxt}>Ekle</Text>
              </TouchableOpacity>
            </View>

            {label("BUGÜNKÜ KAYITLAR")}
            {intake.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <Text style={{ fontSize: 40, marginBottom: 8 }}>🫙</Text>
                <Text style={{ fontSize: 14, color: "#aaa", textAlign: "center" }}>Henüz su içmediniz.{"\n"}Yukarıdan başlayın!</Text>
              </View>
            ) : [...intake].reverse().map(e => (
              <View key={e.id} style={[st.row, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>💧</Text>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: theme.a }}>{e.amount} ml</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontSize: 12, color: theme.b, backgroundColor: hexA(theme.ring, "18"), borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2, fontWeight: "600", overflow: "hidden" }}>{e.time}</Text>
                  <TouchableOpacity onPress={() => removeEntry(e.id)} style={{ marginLeft: 10 }}>
                    <Text style={{ fontSize: 16, color: "#ccc" }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* STATS */}
        {tab === "stats" && (
          <View>
            {label("HAFTALIK ÖZET")}
            <View style={[st.card, { borderColor: theme.border, marginBottom: 16 }]}>
              <BarChart data={chartData} color={theme.ring} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
              {[
                { k: "Bu hafta", v: fmt(weekData.reduce((a, b) => a + b, 0)), e: "📅" },
                { k: "En iyi gün", v: fmt(Math.max(...weekData)), e: "🏆" },
                { k: "Bugün", v: fmt(total), e: "💧" },
                { k: "Hedef", v: fmt(goal), e: "🎯" },
              ].map(({ k, v, e }) => (
                <View key={k} style={[st.card, { borderColor: theme.border, width: "48%", alignItems: "center", marginBottom: 12, paddingVertical: 16 }]}>
                  <Text style={{ fontSize: 24, marginBottom: 4 }}>{e}</Text>
                  <Text style={{ fontSize: 18, fontWeight: "900", color: theme.a }}>{v}</Text>
                  <Text style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{k}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* REMINDERS */}
        {tab === "reminders" && (
          <View>
            {label("YENİ HATIRLATMA")}
            <View style={[st.card, { borderColor: theme.border, marginBottom: 16 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Stepper value={newH} setValue={setNewH} max={23} theme={theme} />
                  <Text style={{ fontSize: 22, fontWeight: "900", color: theme.ring, marginHorizontal: 6 }}>:</Text>
                  <Stepper value={newM} setValue={setNewM} max={55} step={5} theme={theme} />
                </View>
                <TouchableOpacity onPress={addReminder} style={[st.gradBtn, { backgroundColor: theme.a }]}>
                  <Text style={st.gradBtnTxt}>+ Ekle</Text>
                </TouchableOpacity>
              </View>
            </View>

            {label("HATIRLATMALARIM")}
            {reminders.map(r => (
              <View key={r.id} style={[st.row, { borderColor: r.active ? theme.border : "#e0e0e0", backgroundColor: r.active ? theme.card : "#fafafa", opacity: r.active ? 1 : 0.6 }]}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontSize: 22, marginRight: 12 }}>{r.active ? "🔔" : "🔕"}</Text>
                  <Text style={{ fontSize: 18, fontWeight: "900", color: r.active ? theme.a : "#888" }}>{r.time}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <TouchableOpacity onPress={() => toggleReminder(r.id)}
                    style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, borderWidth: 1.5, borderColor: r.active ? theme.ring : "#ccc", backgroundColor: r.active ? hexA(theme.ring, "18") : "#f0f0f0" }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: r.active ? theme.a : "#888" }}>{r.active ? "Açık" : "Kapalı"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteReminder(r.id)} style={{ marginLeft: 8 }}>
                    <Text style={{ fontSize: 18, color: "#ccc" }}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* SETTINGS */}
        {tab === "settings" && (
          <View>
            {label("TEMA SEÇİMİ")}
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 16 }}>
              {THEMES.map((t, i) => (
                <TouchableOpacity key={i} onPress={() => setThemeIdx(i)}
                  style={{ width: "48%", flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 2, borderColor: i === themeIdx ? t.a : t.border, backgroundColor: i === themeIdx ? hexA(t.a, "11") : t.card, marginBottom: 8 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 99, backgroundColor: t.a, marginRight: 8 }} />
                  <Text style={{ fontSize: 13, fontWeight: "700", color: i === themeIdx ? t.a : "#555" }}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {label("GÜNLÜK SU HEDEFİ")}
            <View style={[st.card, { borderColor: theme.border, flexDirection: "row", alignItems: "center", marginBottom: 4 }]}>
              <TextInput value={newGoal} onChangeText={setNewGoal} keyboardType="numeric"
                style={[st.input, { flex: 1, borderColor: theme.border, color: theme.a }]} />
              <TouchableOpacity onPress={saveGoal} style={[st.gradBtn, { backgroundColor: theme.a, marginLeft: 8 }]}>
                <Text style={st.gradBtnTxt}>Kaydet</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: "#888", marginBottom: 16, paddingLeft: 4 }}>Mevcut: {fmt(goal)}</Text>

            {label("GÜNLÜK ÖZET")}
            <View style={[st.card, { borderColor: theme.border, marginBottom: 16 }]}>
              {[["İçilen", fmt(total), theme.b], ["Kalan", fmt(Math.max(0, goal - total)), theme.ring], ["Tamamlama", pct + "%", theme.a]].map(([k, v, c]) => (
                <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: theme.border }}>
                  <Text style={{ fontSize: 14, color: "#888" }}>{k}</Text>
                  <Text style={{ fontSize: 16, fontWeight: "900", color: c }}>{v}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity onPress={() => { setIntake([]); setWeekData(prev => { const n = [...prev]; n[todayIdx] = 0; return n; }); }}
              style={{ paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, borderColor: "#f7c1c1", backgroundColor: "#fff8f8", alignItems: "center" }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#A32D2D" }}>🔄 Günü Sıfırla</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Bottom Nav */}
      <View style={[st.nav, { borderTopColor: theme.border, paddingBottom: 8 + insets.bottom }]}>
        {tabs.map(t => (
          <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}>
            <Text style={{ fontSize: 20, opacity: tab === t.id ? 1 : 0.4 }}>{t.icon}</Text>
            <Text style={{ fontSize: 9, fontWeight: tab === t.id ? "800" : "400", color: tab === t.id ? theme.a : "#aaa", marginTop: 2 }}>{t.label}</Text>
            {tab === t.id && <View style={{ width: 20, height: 3, borderRadius: 99, backgroundColor: theme.a, marginTop: 2 }} />}
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

function Stepper({ value, setValue, max, step = 1, theme }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: theme.border, borderRadius: 10, backgroundColor: theme.bg }}>
      <TouchableOpacity onPress={() => setValue(v => (v - step + (max + step)) % (max + step))} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: theme.a }}>−</Text>
      </TouchableOpacity>
      <Text style={{ fontSize: 16, fontWeight: "700", color: theme.a, width: 28, textAlign: "center" }}>{String(value).padStart(2, "0")}</Text>
      <TouchableOpacity onPress={() => setValue(v => (v + step) % (max + step))} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: theme.a }}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0 },
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14 },
  headerSub: { fontSize: 11, color: "#fff", opacity: 0.8, letterSpacing: 1.5, marginBottom: 2 },
  headerTitle: { fontSize: 21, color: "#fff", fontWeight: "800" },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 10 },
  card: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, padding: 16 },
  ringCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  quickBtn: { width: "18.5%", paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, alignItems: "center" },
  input: { fontSize: 15, fontWeight: "700", paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1.5, borderRadius: 12 },
  gradBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12 },
  gradBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 7 },
  nav: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", backgroundColor: "#fff", borderTopWidth: 1, paddingVertical: 8 },
});