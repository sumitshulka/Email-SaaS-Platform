type IntlWithTimeZones = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

const supportedTimeZones = (Intl as IntlWithTimeZones).supportedValuesOf?.("timeZone") ?? [
  "Africa/Cairo", "Africa/Johannesburg", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/New_York", "America/Sao_Paulo", "Asia/Dubai",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
  "Europe/Berlin", "Europe/London", "Pacific/Auckland",
];

export const standardContactTimeZones = ["UTC", ...supportedTimeZones]
  .filter((zone, index, zones) => zones.indexOf(zone) === index)
  .sort((a, b) => a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b));
