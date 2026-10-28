importScripts("auth.js");

function ensureAlarm() {
  chrome.alarms.create("ps.refresh", { periodInMinutes: 10 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "ps.refresh") return;
  try {
    await refreshAllProfiles();
  } catch (error) {
    console.warn("PS Switcher alarm refresh failed", error);
  }
});

ensureAlarm();
