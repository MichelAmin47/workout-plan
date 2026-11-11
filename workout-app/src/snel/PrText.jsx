// "· PR 32kg" suffix for the "Laatste keer" line. Green when the weight
// logged for the viewed week equals the PR (hit or set it this week).
// Shared by the old look (theme null) and the redesign's log panel, so it
// lives in its own module (moved unchanged from fitness_schema.jsx).
export default function PrText({ pr, currentWeight, standalone, theme }) {
  if (!pr) return null;
  const isCurrent = currentWeight !== "" && currentWeight != null && Number(currentWeight) === pr.num;
  return (
    <>
      {!standalone && " · "}
      <span style={{ whiteSpace: "nowrap" }}>
        PR <span style={{ color: isCurrent ? (theme ? theme.success : "#16a34a") : (theme ? theme.text : "#1a1a1a"), fontWeight: isCurrent ? 700 : (theme ? 600 : 400) }}>{pr.value}kg</span>
      </span>
    </>
  );
}
