//! The trash: a record can be moved out of every view and back, or, while it
//! is in the trash, removed for good after an automatic backup. Removal is
//! refused when the record is part of history töre must keep intact.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrashInput {
    id: String,
    #[serde(default)]
    expected_revision: Option<u32>,
    confirmed_by_user: bool,
}

impl Disk {
    fn trash_target(&self, input: Value) -> Result<(TrashInput, Record), String> {
        self.check()?;
        let r: TrashInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Silme ve geri alma yalnız açık onayla yapılır".into());
        }
        let record = self
            .data
            .records
            .get(&r.id)
            .ok_or("Kayıt bulunamadı")?
            .clone();
        if r.expected_revision.is_some_and(|v| v != record.revision) {
            return Err("Kayıt değişmiş; yeniden yükleyin".into());
        }
        Ok((r, record))
    }

    pub fn trash(&mut self, input: Value) -> Result<Value, String> {
        let (_, mut record) = self.trash_target(input)?;
        if record.trashed_at.is_some() {
            return Ok(json!({"record":record,"changed":false}));
        }
        record.trashed_at = Some(now());
        let mut next = self.data.clone();
        next.records.insert(record.id.clone(), record.clone());
        self.commit(next)?;
        Ok(json!({"record":record,"changed":true}))
    }

    pub fn untrash(&mut self, input: Value) -> Result<Value, String> {
        let (_, mut record) = self.trash_target(input)?;
        if record.trashed_at.is_none() {
            return Ok(json!({"record":record,"changed":false}));
        }
        record.trashed_at = None;
        let mut next = self.data.clone();
        next.records.insert(record.id.clone(), record.clone());
        self.commit(next)?;
        Ok(json!({"record":record,"changed":true}))
    }

    /// Why a trashed record cannot leave the store, if it cannot.
    fn purge_blocker(&self, id: &str) -> Option<&'static str> {
        let s = &self.data;
        if s.packets
            .values()
            .any(|p| p.record_ids.iter().chain(&p.proposal_ids).any(|x| x == id))
        {
            return Some(
                "Bu kayıt bir devam metninde kullanıldı; geçmiş metinler bozulmasın diye kalıcı silinemez. Çöp kutusunda gizli kalır.",
            );
        }
        if organize::receipts_mention(s, id) {
            return Some(
                "Bu kayıt bir konu düzenlemesinin geçmişinde duruyor; kalıcı silinemez. Çöp kutusunda gizli kalır.",
            );
        }
        if s.records.get(id).is_some_and(|r| r.legacy.is_some()) {
            return Some(
                "Bu kayıt eski görüş defterinden aktarıldı; aktarım geçmişi bozulmasın diye kalıcı silinemez. Çöp kutusunda gizli kalır.",
            );
        }
        if s.records
            .values()
            .any(|r| r.answers_question_id.as_deref() == Some(id))
        {
            return Some("Bu soruya bağlı yanıtlar var; önce onları kalıcı sil.");
        }
        if s.records
            .values()
            .any(|r| r.superseded_by.as_deref() == Some(id))
            || s.records.get(id).is_some_and(|r| r.superseded_by.is_some())
        {
            return Some(
                "Bu kayıt bir düşünce mirasının parçası (aşılan ya da aşan); kalıcı silinemez. Çöp kutusunda gizli kalır.",
            );
        }
        if reports::mentions(s, id) {
            return Some(
                "Bu kayıt bir rapordan geldi; rapor geçmişi bozulmasın diye kalıcı silinemez. Çöp kutusunda gizli kalır.",
            );
        }
        if let Some(entry) = s.map_entries.values().find(|e| e.record_id == id) {
            if s.map_entries
                .values()
                .any(|e| e.parent_id.as_ref() == Some(&entry.id))
            {
                return Some(
                    "Haritada bu kayda bağlı başka girdiler var; kalıcı silinemez. Çöp kutusunda gizli kalır.",
                );
            }
        }
        None
    }

    pub fn purge(&mut self, input: Value) -> Result<Value, String> {
        let (_, record) = self.trash_target(input)?;
        if record.trashed_at.is_none() {
            return Err("Kalıcı silmek için kaydı önce çöp kutusuna taşı".into());
        }
        if let Some(why) = self.purge_blocker(&record.id) {
            return Err(why.into());
        }
        let backup = self.backup()?;
        let id = record.id;
        let mut next = self.data.clone();
        next.records.remove(&id);
        next.map_entries.retain(|_, e| e.record_id != id);
        next.thinker_links.retain(|_, l| l.record_id != id);
        for link in next.conversation_links.values_mut() {
            link.candidate_ids.retain(|x| x != &id);
        }
        for handled in next.inbox_handled.values_mut() {
            if handled.record_id.as_deref() == Some(id.as_str()) {
                handled.record_id = None;
            }
        }
        self.commit(next)?;
        Ok(json!({"purged":id,"backupId":backup["backupId"]}))
    }
}
