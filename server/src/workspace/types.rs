use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub schema_version: u32,
    pub id: String,
    pub provider: String,
    pub source_app: String,
    pub source_conversation_id: String,
    pub title: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub selected_leaf_id: Option<String>,
    pub messages: Vec<Message>,
    pub warnings: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub source_id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub phase: Option<String>,
    pub text: String,
    pub attachments: Vec<String>,
    pub timestamp: Option<String>,
    pub source_locator: String,
    pub authorship_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewedMessage {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    pub id: String,
    pub role: String,
    pub text: String,
    pub authorship: String,
    pub rights: String,
    pub feedback: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDraft {
    pub schema_version: u32,
    pub id: String,
    pub hash: String,
    pub conversation_id: String,
    pub leaf_id: String,
    pub intent: String,
    pub purpose: String,
    pub developer: String,
    pub model_id: String,
    pub mode: String,
    pub question: String,
    pub context_text: String,
    pub messages: Vec<ReviewedMessage>,
    pub warnings: Vec<String>,
    pub status: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReceipt {
    pub schema_version: u32,
    pub id: String,
    pub draft_id: String,
    pub draft_hash: String,
    pub status: String,
    pub mode: String,
    pub developer: String,
    pub model_id: String,
    pub provider: Option<String>,
    pub usage: serde_json::Value,
    pub created_at: String,
    pub conversation_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetPackage {
    pub schema_version: u32,
    pub package_id: String,
    pub dataset_jsonl: String,
    pub manifest: serde_json::Value,
    pub readme: String,
}
