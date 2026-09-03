export const microsoftConfig = {
  // Microsoft Graph / OneDrive用。v0.14系で実機利用していたEntraアプリ。
  graphClientId: "f7074fad-6ea0-467b-98db-e308f01950cc",
  tenantId: "538265b8-8d15-49ef-9d51-ca252954de1d",
  graphScopes: ["User.Read", "Files.ReadWrite", "Sites.ReadWrite.All"],

  // 調査システムが使用するOneDrive業務ルート。
  // 接続成功条件は、この固定共有URLからdriveId/itemIdを解決し実アクセスできること。
  surveyRootName: "04 調査",
  surveyRootUrl: "https://odawarakoseki-my.sharepoint.com/my?remoteItem=%7B%22mp%22%3A%7B%22webAbsoluteUrl%22%3A%22https%3A%2F%2Fodawarakoseki%2Dmy%2Esharepoint%2Ecom%2Fpersonal%2Fkawakubo%5Fodawarakoseki%5Fonmicrosoft%5Fcom%22%2C%22listFullUrl%22%3A%22https%3A%2F%2Fodawarakoseki%2Dmy%2Esharepoint%2Ecom%2Fpersonal%2Fkawakubo%5Fodawarakoseki%5Fonmicrosoft%5Fcom%2FDocuments%22%2C%22rootFolder%22%3A%22%2Fpersonal%2Fkawakubo%5Fodawarakoseki%5Fonmicrosoft%5Fcom%2FDocuments%2F%E6%BF%B1%E8%88%98%E5%8E%9A%20%E3%81%95%E3%82%93%E3%81%AE%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB%20%2D%2004%20%E8%AA%BF%E6%9F%BB%22%7D%2C%22rsi%22%3A%7B%22webAbsoluteUrl%22%3A%22https%3A%2F%2Fodawarakoseki%2Dmy%2Esharepoint%2Ecom%2Fpersonal%2Faccount%5Fodawarakoseki%5Fonmicrosoft%5Fcom%22%2C%22listFullUrl%22%3A%22https%3A%2F%2Fodawarakoseki%2Dmy%2Esharepoint%2Ecom%2Fpersonal%2Faccount%5Fodawarakoseki%5Fonmicrosoft%5Fcom%2FDocuments%22%2C%22rootFolder%22%3A%22%2Fpersonal%2Faccount%5Fodawarakoseki%5Fonmicrosoft%5Fcom%2FDocuments%2F04%20%E8%AA%BF%E6%9F%BB%22%7D%7D"
};
