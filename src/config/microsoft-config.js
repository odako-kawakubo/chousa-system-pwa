export const microsoftConfig = {
  // Microsoft Graph / OneDrive用。v0.14系で実機利用していたEntraアプリ。
  graphClientId: "f7074fad-6ea0-467b-98db-e308f01950cc",
  tenantId: "538265b8-8d15-49ef-9d51-ca252954de1d",
  graphScopes: ["User.Read", "Files.ReadWrite", "Sites.ReadWrite.All"],

  // 管理者アカウントで取得済みの「04 調査」実体ID。全利用者で共通。
  surveyRootName: "04 調査",
  surveyRootDriveId: "b!MSzS2TMA302NtWmb6CsWi-ZydvjmVW9MukCoa5MoRTs6K64zl6ROS4iLribSuKHV",
  surveyRootItemId: "01FQHN4IP66KIOIN5MPBDJADZPVGCLXGQV"
};
