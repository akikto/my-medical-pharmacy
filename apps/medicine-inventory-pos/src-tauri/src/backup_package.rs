use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use super::{
    medicine_photo_path, normalized_photo_ref_for_medicine, validate_backup_database,
    validate_medicine_photo_bytes,
};

pub(super) const DATABASE_ENTRY: &str = "pharmacy.db";
const MANIFEST_ENTRY: &str = "my-medical-backup.json";
const BACKUP_FORMAT: &str = "MY_MEDICAL_COMPLETE_BACKUP";
const BACKUP_FORMAT_VERSION: u32 = 1;
const PHOTO_ARCHIVE_PREFIX: &str = "photos/";
const ATTACHMENT_ARCHIVE_PREFIX: &str = "purchase-attachments/";
const MAX_MEDICINE_PHOTO_BYTES: u64 = 2_000_000;
const MAX_PURCHASE_ATTACHMENT_BYTES: u64 = 20_000_000;
const MAX_BACKUP_DATABASE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_BACKUP_TOTAL_PHOTO_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_BACKUP_TOTAL_ATTACHMENT_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_BACKUP_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_BACKUP_PHOTO_COUNT: usize = 100_000;
const MAX_BACKUP_ATTACHMENT_COUNT: usize = 100_000;
const MAX_BACKUP_ARCHIVE_ENTRIES: usize =
    MAX_BACKUP_PHOTO_COUNT + MAX_BACKUP_ATTACHMENT_COUNT + 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BackupSourceFormat {
    CompleteArchive,
    LegacyDatabaseOnly,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct BackupPhotoSummary {
    pub photo_count: usize,
    pub ignored_orphaned_photo_count: usize,
    pub attachment_count: usize,
    pub ignored_orphaned_attachment_count: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct RestoredPhotoSummary {
    pub photo_count: usize,
    pub ignored_orphaned_photo_count: usize,
    pub attachment_count: usize,
    pub ignored_orphaned_attachment_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompleteBackupManifest {
    format: String,
    version: u32,
    database_entry: String,
    photos: Vec<BackupPhotoEntry>,
    ignored_orphaned_photo_count: usize,
    #[serde(default)]
    attachments: Vec<BackupAttachmentEntry>,
    #[serde(default)]
    ignored_orphaned_attachment_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupPhotoEntry {
    medicine_id: i64,
    photo_ref: String,
    archive_path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupAttachmentEntry {
    attachment_id: i64,
    purchase_id: i64,
    file_ref: String,
    file_name: String,
    mime_type: String,
    archive_path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AttachmentReference {
    attachment_id: i64,
    purchase_id: i64,
    file_ref: String,
    file_name: String,
    mime_type: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PhotoReference {
    medicine_id: i64,
    photo_ref: String,
}

pub(super) fn create_complete_backup_from_snapshot(
    database_snapshot: &Path,
    photo_directory: &Path,
    destination: &Path,
) -> Result<BackupPhotoSummary, String> {
    validate_backup_database(database_snapshot)?;
    if destination.exists() || fs::symlink_metadata(destination).is_ok() {
        return Err("A file already exists at the staged backup location.".to_owned());
    }

    let mut destination_created = false;
    let result = (|| {
        let references = database_photo_references(database_snapshot)?;
        if references.len() > MAX_BACKUP_PHOTO_COUNT {
            return Err("This database references too many medicine photos for one backup.".to_owned());
        }

        let referenced_names = references
            .iter()
            .map(|reference| reference.photo_ref.clone())
            .collect::<HashSet<_>>();
        let ignored_orphaned_photo_count =
            count_orphaned_photo_files(photo_directory, &referenced_names)?;
        let attachment_directory = purchase_attachment_directory_for_photos(photo_directory)?;
        let attachment_references = database_attachment_references(database_snapshot)?;
        if attachment_references.len() > MAX_BACKUP_ATTACHMENT_COUNT {
            return Err("This database references too many purchase attachments for one backup.".to_owned());
        }
        let referenced_attachment_names = attachment_references
            .iter()
            .map(|reference| reference.file_ref.clone())
            .collect::<HashSet<_>>();
        let ignored_orphaned_attachment_count = count_orphaned_attachment_files(
            &attachment_directory,
            &referenced_attachment_names,
        )?;

        let destination_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|error| format!("Could not create the complete backup package: {error}"))?;
        destination_created = true;
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);
        let mut archive = ZipWriter::new(destination_file);

        let database_size = fs::metadata(database_snapshot)
            .map_err(|error| format!("Could not inspect the database snapshot: {error}"))?
            .len();
        if database_size > MAX_BACKUP_DATABASE_BYTES {
            return Err("The database is too large for the supported backup format.".to_owned());
        }
        archive
            .start_file(DATABASE_ENTRY, options)
            .map_err(|error| format!("Could not add the database to the backup package: {error}"))?;
        let mut database_file = File::open(database_snapshot)
            .map_err(|error| format!("Could not read the database snapshot: {error}"))?;
        io::copy(&mut database_file, &mut archive)
            .map_err(|error| format!("Could not write the database into the backup package: {error}"))?;

        let mut total_photo_bytes = 0u64;
        let mut photo_entries = Vec::with_capacity(references.len());
        for reference in &references {
            let bytes = read_referenced_photo(photo_directory, reference)?;
            total_photo_bytes = total_photo_bytes
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| "The medicine photos are too large for one backup.".to_owned())?;
            if total_photo_bytes > MAX_BACKUP_TOTAL_PHOTO_BYTES {
                return Err("The medicine photos are too large for one backup.".to_owned());
            }
            let archive_path = photo_archive_path(&reference.photo_ref);
            archive
                .start_file(&archive_path, options)
                .map_err(|error| format!("Could not add a medicine photo to the backup package: {error}"))?;
            archive
                .write_all(&bytes)
                .map_err(|error| format!("Could not write a medicine photo into the backup package: {error}"))?;
            photo_entries.push(BackupPhotoEntry {
                medicine_id: reference.medicine_id,
                photo_ref: reference.photo_ref.clone(),
                archive_path,
                size_bytes: bytes.len() as u64,
                sha256: sha256_hex(&bytes),
            });
        }

        let mut total_attachment_bytes = 0u64;
        let mut attachment_entries = Vec::with_capacity(attachment_references.len());
        for reference in &attachment_references {
            let bytes = read_referenced_attachment(&attachment_directory, reference)?;
            total_attachment_bytes = total_attachment_bytes
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| "The purchase attachments are too large for one backup.".to_owned())?;
            if total_attachment_bytes > MAX_BACKUP_TOTAL_ATTACHMENT_BYTES {
                return Err("The purchase attachments are too large for one backup.".to_owned());
            }
            let archive_path = attachment_archive_path(&reference.file_ref);
            archive
                .start_file(&archive_path, options)
                .map_err(|error| format!("Could not add a purchase attachment to the backup package: {error}"))?;
            archive
                .write_all(&bytes)
                .map_err(|error| format!("Could not write a purchase attachment into the backup package: {error}"))?;
            attachment_entries.push(BackupAttachmentEntry {
                attachment_id: reference.attachment_id,
                purchase_id: reference.purchase_id,
                file_ref: reference.file_ref.clone(),
                file_name: reference.file_name.clone(),
                mime_type: reference.mime_type.clone(),
                archive_path,
                size_bytes: bytes.len() as u64,
                sha256: reference.sha256.clone(),
            });
        }

        let manifest = CompleteBackupManifest {
            format: BACKUP_FORMAT.to_owned(),
            version: BACKUP_FORMAT_VERSION,
            database_entry: DATABASE_ENTRY.to_owned(),
            photos: photo_entries,
            ignored_orphaned_photo_count,
            attachments: attachment_entries,
            ignored_orphaned_attachment_count,
        };
        let manifest_bytes = serde_json::to_vec(&manifest)
            .map_err(|error| format!("Could not write the backup manifest: {error}"))?;
        if manifest_bytes.len() as u64 > MAX_BACKUP_MANIFEST_BYTES {
            return Err("The medicine photo list is too large for the supported backup format.".to_owned());
        }
        archive
            .start_file(MANIFEST_ENTRY, options)
            .map_err(|error| format!("Could not add the backup manifest: {error}"))?;
        archive
            .write_all(&manifest_bytes)
            .map_err(|error| format!("Could not write the backup manifest: {error}"))?;

        let package_file = archive
            .finish()
            .map_err(|error| format!("Could not finalize the complete backup package: {error}"))?;
        package_file
            .sync_all()
            .map_err(|error| format!("Could not safely finish the backup package: {error}"))?;

        Ok(BackupPhotoSummary {
            photo_count: references.len(),
            ignored_orphaned_photo_count,
            attachment_count: attachment_references.len(),
            ignored_orphaned_attachment_count,
        })
    })();

    if result.is_err() && destination_created {
        let _ = fs::remove_file(destination);
    }
    result
}

pub(super) fn stage_complete_backup(
    source: &Path,
    staged_database: &Path,
    staged_photo_directory: &Path,
) -> Result<BackupPhotoSummary, String> {
    if staged_database.exists() || fs::symlink_metadata(staged_database).is_ok() {
        return Err("A restore staging database already exists.".to_owned());
    }
    if staged_photo_directory.exists() || fs::symlink_metadata(staged_photo_directory).is_ok() {
        return Err("A restore staging photo folder already exists.".to_owned());
    }
    let staged_attachment_directory =
        staged_purchase_attachment_directory(staged_photo_directory)?;
    if staged_attachment_directory.exists()
        || fs::symlink_metadata(&staged_attachment_directory).is_ok()
    {
        return Err("A purchase attachment staging folder already exists.".to_owned());
    }

    let result = stage_complete_backup_inner(
        source,
        staged_database,
        staged_photo_directory,
        &staged_attachment_directory,
    );
    if result.is_err() {
        let _ = fs::remove_file(staged_database);
        let _ = fs::remove_dir_all(staged_photo_directory);
        let _ = fs::remove_dir_all(&staged_attachment_directory);
    }
    result
}

fn stage_complete_backup_inner(
    source: &Path,
    staged_database: &Path,
    staged_photo_directory: &Path,
    staged_attachment_directory: &Path,
) -> Result<BackupPhotoSummary, String> {
    let source_file = File::open(source)
        .map_err(|error| format!("Could not open the complete backup package: {error}"))?;
    let mut archive = ZipArchive::new(source_file)
        .map_err(|error| format!("The selected file is not a valid complete backup package: {error}"))?;
    if archive.len() < 2 || archive.len() > MAX_BACKUP_ARCHIVE_ENTRIES {
        return Err("The complete backup package has an unsupported number of files.".to_owned());
    }

    let mut archive_names = HashSet::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not inspect the complete backup package: {error}"))?;
        if entry.is_dir() {
            return Err("The complete backup package contains an unexpected folder.".to_owned());
        }
        let name = entry.name().to_owned();
        if name.is_empty() || !archive_names.insert(name) {
            return Err("The complete backup package contains an invalid or duplicate file.".to_owned());
        }
    }

    let manifest_bytes = {
        let entry = archive
            .by_name(MANIFEST_ENTRY)
            .map_err(|_| "The selected archive is missing its MY MEDICAL backup manifest.".to_owned())?;
        let declared_size = entry.size();
        if declared_size > MAX_BACKUP_MANIFEST_BYTES {
            return Err("The backup manifest is too large to validate safely.".to_owned());
        }
        let mut bytes = Vec::with_capacity(declared_size as usize);
        entry
            .take(MAX_BACKUP_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Could not read the backup manifest: {error}"))?;
        if bytes.len() as u64 != declared_size {
            return Err("The backup manifest has an invalid size.".to_owned());
        }
        bytes
    };
    let manifest: CompleteBackupManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("The backup manifest is invalid: {error}"))?;
    if manifest.format != BACKUP_FORMAT
        || manifest.version != BACKUP_FORMAT_VERSION
        || manifest.database_entry != DATABASE_ENTRY
    {
        return Err("The selected archive is not a supported MY MEDICAL complete backup.".to_owned());
    }
    if manifest.photos.len() > MAX_BACKUP_PHOTO_COUNT {
        return Err("The complete backup lists too many medicine photos.".to_owned());
    }
    let total_photo_bytes = manifest.photos.iter().try_fold(0u64, |total, photo| {
        total.checked_add(photo.size_bytes)
    });
    if total_photo_bytes.is_none_or(|total| total > MAX_BACKUP_TOTAL_PHOTO_BYTES) {
        return Err("The medicine photos are too large for one backup.".to_owned());
    }
    if manifest.ignored_orphaned_photo_count > MAX_BACKUP_PHOTO_COUNT {
        return Err("The backup manifest reports an unsupported number of omitted files.".to_owned());
    }
    if manifest.attachments.len() > MAX_BACKUP_ATTACHMENT_COUNT
        || manifest.ignored_orphaned_attachment_count > MAX_BACKUP_ATTACHMENT_COUNT
    {
        return Err("The backup manifest reports an unsupported number of purchase attachments.".to_owned());
    }
    let total_attachment_bytes = manifest.attachments.iter().try_fold(0u64, |total, attachment| {
        total.checked_add(attachment.size_bytes)
    });
    if total_attachment_bytes.is_none_or(|total| total > MAX_BACKUP_TOTAL_ATTACHMENT_BYTES) {
        return Err("The purchase attachments are too large for one backup.".to_owned());
    }

    let mut manifest_references = HashSet::with_capacity(manifest.photos.len());
    let mut manifest_attachment_references =
        HashSet::with_capacity(manifest.attachments.len());
    let mut expected_archive_names = HashSet::with_capacity(
        manifest.photos.len() + manifest.attachments.len() + 2,
    );
    expected_archive_names.insert(MANIFEST_ENTRY.to_owned());
    expected_archive_names.insert(DATABASE_ENTRY.to_owned());
    for photo in &manifest.photos {
        if photo.medicine_id <= 0 {
            return Err("The backup manifest contains an invalid medicine id.".to_owned());
        }
        let normalized = normalized_photo_ref_for_medicine(
            Some(photo.photo_ref.clone()),
            photo.medicine_id,
        )?;
        if normalized.as_deref() != Some(photo.photo_ref.as_str()) {
            return Err("The backup manifest contains an invalid medicine photo reference.".to_owned());
        }
        let expected_path = photo_archive_path(&photo.photo_ref);
        if photo.archive_path != expected_path
            || photo.size_bytes == 0
            || photo.size_bytes > MAX_MEDICINE_PHOTO_BYTES
            || !is_sha256_hex(&photo.sha256)
        {
            return Err("The backup manifest contains invalid medicine photo metadata.".to_owned());
        }
        if !manifest_references.insert(PhotoReference {
            medicine_id: photo.medicine_id,
            photo_ref: photo.photo_ref.clone(),
        }) || !expected_archive_names.insert(photo.archive_path.clone())
        {
            return Err("The backup manifest contains a duplicate medicine photo.".to_owned());
        }
    }
    for attachment in &manifest.attachments {
        let reference = AttachmentReference {
            attachment_id: attachment.attachment_id,
            purchase_id: attachment.purchase_id,
            file_ref: attachment.file_ref.clone(),
            file_name: attachment.file_name.clone(),
            mime_type: attachment.mime_type.clone(),
            size_bytes: attachment.size_bytes,
            sha256: attachment.sha256.clone(),
        };
        validate_attachment_reference(&reference)?;
        let expected_path = attachment_archive_path(&attachment.file_ref);
        if attachment.archive_path != expected_path
            || !manifest_attachment_references.insert(reference)
            || !expected_archive_names.insert(attachment.archive_path.clone())
        {
            return Err("The backup manifest contains an invalid or duplicate purchase attachment.".to_owned());
        }
    }
    if archive_names != expected_archive_names {
        return Err("The complete backup is missing required files or contains unexpected files.".to_owned());
    }

    let database_size = {
        let entry = archive
            .by_name(DATABASE_ENTRY)
            .map_err(|_| "The complete backup is missing its SQLite database.".to_owned())?;
        let declared_size = entry.size();
        if declared_size == 0 || declared_size > MAX_BACKUP_DATABASE_BYTES {
            return Err("The database in the complete backup has an unsupported size.".to_owned());
        }
        let mut destination = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(staged_database)
            .map_err(|error| format!("Could not stage the restored database: {error}"))?;
        let copied = io::copy(
            &mut entry.take(MAX_BACKUP_DATABASE_BYTES + 1),
            &mut destination,
        )
            .map_err(|error| format!("Could not read the database from the backup package: {error}"))?;
        if copied != declared_size {
            return Err("The database in the complete backup is incomplete.".to_owned());
        }
        destination
            .sync_all()
            .map_err(|error| format!("Could not safely stage the restored database: {error}"))?;
        copied
    };
    if database_size == 0 {
        return Err("The complete backup does not contain a database.".to_owned());
    }
    validate_backup_database(staged_database)?;

    let database_references = database_photo_references(staged_database)?
        .into_iter()
        .collect::<HashSet<_>>();
    if database_references != manifest_references {
        return Err("The complete backup does not contain exactly the photos referenced by its database.".to_owned());
    }
    let database_attachment_refs = database_attachment_references(staged_database)?
        .into_iter()
        .collect::<HashSet<_>>();
    if database_attachment_refs != manifest_attachment_references {
        return Err("The complete backup does not contain exactly the purchase attachments referenced by its database.".to_owned());
    }

    fs::create_dir(staged_photo_directory)
        .map_err(|error| format!("Could not create the restore staging photo folder: {error}"))?;
    fs::create_dir(staged_attachment_directory).map_err(|error| {
        format!("Could not create the purchase attachment restore folder: {error}")
    })?;
    for photo in &manifest.photos {
        let entry = archive
            .by_name(&photo.archive_path)
            .map_err(|_| format!("The backup is missing medicine photo {}.", photo.photo_ref))?;
        if entry.size() != photo.size_bytes {
            return Err(format!(
                "Medicine photo {} has an invalid size in the backup.",
                photo.photo_ref
            ));
        }
        let mut bytes = Vec::with_capacity(photo.size_bytes as usize);
        entry
            .take(MAX_MEDICINE_PHOTO_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Could not read medicine photo {}: {error}", photo.photo_ref))?;
        if bytes.len() as u64 != photo.size_bytes || sha256_hex(&bytes) != photo.sha256 {
            return Err(format!(
                "Medicine photo {} is missing, incomplete, or corrupt in the backup.",
                photo.photo_ref
            ));
        }
        validate_medicine_photo_bytes(&bytes).map_err(|_| {
            format!(
                "Medicine photo {} is corrupt in the backup.",
                photo.photo_ref
            )
        })?;

        let destination = medicine_photo_path(
            staged_photo_directory,
            photo.medicine_id,
            &photo.photo_ref,
        )?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| format!("Could not stage medicine photo {}: {error}", photo.photo_ref))?;
        output
            .write_all(&bytes)
            .and_then(|()| output.sync_all())
            .map_err(|error| format!("Could not safely stage medicine photo {}: {error}", photo.photo_ref))?;
    }
    for attachment in &manifest.attachments {
        let entry = archive
            .by_name(&attachment.archive_path)
            .map_err(|_| format!("The backup is missing purchase attachment {}.", attachment.file_name))?;
        if entry.size() != attachment.size_bytes {
            return Err(format!(
                "Purchase attachment {} has an invalid size in the backup.",
                attachment.file_name
            ));
        }
        let mut bytes = Vec::with_capacity(attachment.size_bytes as usize);
        entry
            .take(MAX_PURCHASE_ATTACHMENT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Could not read purchase attachment {}: {error}", attachment.file_name))?;
        if bytes.len() as u64 != attachment.size_bytes
            || sha256_hex(&bytes) != attachment.sha256
            || !attachment_content_matches(&bytes, &attachment.mime_type)
        {
            return Err(format!(
                "Purchase attachment {} is missing, incomplete, or corrupt in the backup.",
                attachment.file_name
            ));
        }
        let destination = staged_attachment_directory.join(&attachment.file_ref);
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| format!("Could not stage purchase attachment {}: {error}", attachment.file_name))?;
        output
            .write_all(&bytes)
            .and_then(|()| output.sync_all())
            .map_err(|error| format!("Could not safely stage purchase attachment {}: {error}", attachment.file_name))?;
    }

    let photo_count = validate_photo_references(staged_database, staged_photo_directory)?;
    if photo_count != manifest.photos.len() {
        return Err("The staged photo files do not match the database references.".to_owned());
    }
    let attachment_count =
        validate_attachment_references(staged_database, staged_attachment_directory)?;
    if attachment_count != manifest.attachments.len() {
        return Err("The staged purchase attachments do not match the database references.".to_owned());
    }
    Ok(BackupPhotoSummary {
        photo_count,
        ignored_orphaned_photo_count: manifest.ignored_orphaned_photo_count,
        attachment_count,
        ignored_orphaned_attachment_count: manifest.ignored_orphaned_attachment_count,
    })
}

pub(super) fn validate_photo_references(
    database_path: &Path,
    photo_directory: &Path,
) -> Result<usize, String> {
    let references = database_photo_references(database_path)?;
    for reference in &references {
        read_referenced_photo(photo_directory, reference).map_err(|error| {
            format!(
                "A legacy database-only backup references a medicine photo that is not safely available on this device ({}): {error}",
                reference.photo_ref
            )
        })?;
    }
    Ok(references.len())
}

fn database_photo_references(database_path: &Path) -> Result<Vec<PhotoReference>, String> {
    let connection = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Could not inspect medicine photo references: {error}"))?;
    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not read the database version for photo validation: {error}"))?;
    if version < 7 {
        return Ok(Vec::new());
    }

    let mut statement = connection
        .prepare(
            "SELECT id, photo_ref FROM medicines
             WHERE photo_ref IS NOT NULL ORDER BY id",
        )
        .map_err(|error| format!("Could not read medicine photo references: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Could not read medicine photo references: {error}"))?;
    let mut references = Vec::new();
    for row in rows {
        let (medicine_id, photo_ref) =
            row.map_err(|error| format!("Could not read a medicine photo reference: {error}"))?;
        if medicine_id <= 0 {
            return Err("The database contains an invalid medicine id for a photo.".to_owned());
        }
        let photo_ref = normalized_photo_ref_for_medicine(Some(photo_ref), medicine_id)?
            .ok_or_else(|| "The database contains an empty medicine photo reference.".to_owned())?;
        references.push(PhotoReference {
            medicine_id,
            photo_ref,
        });
    }
    if references.len() > MAX_BACKUP_PHOTO_COUNT {
        return Err("The database references too many medicine photos for one backup.".to_owned());
    }
    Ok(references)
}

fn read_referenced_photo(
    photo_directory: &Path,
    reference: &PhotoReference,
) -> Result<Vec<u8>, String> {
    let directory_metadata = fs::symlink_metadata(photo_directory).map_err(|error| {
        format!(
            "Local medicine photo storage is unavailable: {error}"
        )
    })?;
    if !directory_metadata.file_type().is_dir() {
        return Err("Local medicine photo storage is not a regular folder.".to_owned());
    }
    let path = medicine_photo_path(
        photo_directory,
        reference.medicine_id,
        &reference.photo_ref,
    )?;
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        format!(
            "Referenced medicine photo {} is unavailable: {error}",
            reference.photo_ref
        )
    })?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_MEDICINE_PHOTO_BYTES {
        return Err(format!(
            "Referenced medicine photo {} is not a supported regular file.",
            reference.photo_ref
        ));
    }
    let bytes = fs::read(&path).map_err(|error| {
        format!(
            "Could not read referenced medicine photo {}: {error}",
            reference.photo_ref
        )
    })?;
    if bytes.len() as u64 > MAX_MEDICINE_PHOTO_BYTES {
        return Err(format!(
            "Referenced medicine photo {} exceeds the supported size limit.",
            reference.photo_ref
        ));
    }
    validate_medicine_photo_bytes(&bytes).map_err(|error| {
        format!(
            "Referenced medicine photo {} is corrupt: {error}",
            reference.photo_ref
        )
    })?;
    Ok(bytes)
}

fn count_orphaned_photo_files(
    photo_directory: &Path,
    referenced_names: &HashSet<String>,
) -> Result<usize, String> {
    let directory_metadata = match fs::symlink_metadata(photo_directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound && referenced_names.is_empty() => {
            return Ok(0)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err("A medicine photo referenced by the database is missing.".to_owned())
        }
        Err(error) => return Err(format!("Could not inspect local medicine photo storage: {error}")),
    };
    if !directory_metadata.file_type().is_dir() {
        return Err("Local medicine photo storage is not a regular folder.".to_owned());
    }

    let mut orphaned_count = 0usize;
    for entry in fs::read_dir(photo_directory)
        .map_err(|error| format!("Could not list local medicine photo storage: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not inspect a local medicine photo: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Could not inspect a local medicine photo: {error}"))?
            .is_file()
        {
            return Err("Local medicine photo storage contains an unsupported non-file entry.".to_owned());
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Local medicine photo storage contains an invalid filename.".to_owned())?;
        if !referenced_names.contains(&name) {
            orphaned_count = orphaned_count.saturating_add(1);
            if orphaned_count > MAX_BACKUP_PHOTO_COUNT {
                return Err(
                    "Local medicine photo storage contains too many unreferenced files to back up safely."
                        .to_owned(),
                );
            }
        }
    }
    Ok(orphaned_count)
}

pub(super) fn staged_purchase_attachment_directory(
    staged_photo_directory: &Path,
) -> Result<PathBuf, String> {
    let parent = staged_photo_directory
        .parent()
        .ok_or_else(|| "Could not locate the purchase attachment staging folder.".to_owned())?;
    let name = staged_photo_directory
        .file_name()
        .ok_or_else(|| "Could not identify the purchase attachment staging folder.".to_owned())?
        .to_string_lossy();
    Ok(parent.join(format!("{name}-purchase-attachments")))
}

fn purchase_attachment_directory_for_photos(photo_directory: &Path) -> Result<PathBuf, String> {
    let parent = photo_directory
        .parent()
        .ok_or_else(|| "Could not locate local purchase attachment storage.".to_owned())?;
    Ok(parent.join("purchase-attachments"))
}

fn database_attachment_references(
    database_path: &Path,
) -> Result<Vec<AttachmentReference>, String> {
    let connection = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Could not inspect purchase attachment references: {error}"))?;
    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not read the database version for attachments: {error}"))?;
    if version < 9 {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare(
            r#"SELECT id, purchase_id, file_ref, file_name, mime_type, size_bytes, sha256
               FROM purchase_attachments ORDER BY id"#,
        )
        .map_err(|error| format!("Could not read purchase attachment references: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(AttachmentReference {
                attachment_id: row.get(0)?,
                purchase_id: row.get(1)?,
                file_ref: row.get(2)?,
                file_name: row.get(3)?,
                mime_type: row.get(4)?,
                size_bytes: row.get::<_, i64>(5)? as u64,
                sha256: row.get(6)?,
            })
        })
        .map_err(|error| format!("Could not query purchase attachment references: {error}"))?;
    let mut references = Vec::new();
    for row in rows {
        let reference =
            row.map_err(|error| format!("Could not read a purchase attachment reference: {error}"))?;
        validate_attachment_reference(&reference)?;
        references.push(reference);
        if references.len() > MAX_BACKUP_ATTACHMENT_COUNT {
            return Err("The database references too many purchase attachments for one backup.".to_owned());
        }
    }
    Ok(references)
}

fn validate_attachment_reference(reference: &AttachmentReference) -> Result<(), String> {
    let file_ref = reference.file_ref.as_str();
    let valid_identity = reference.attachment_id > 0
        && reference.purchase_id > 0
        && file_ref.starts_with(&format!("purchase-{}-", reference.purchase_id))
        && !file_ref.contains('/')
        && !file_ref.contains('\\')
        && !file_ref.starts_with('.');
    let (expected_extension, expected_mime) = match reference.mime_type.as_str() {
        "application/pdf" => ("pdf", "application/pdf"),
        "image/jpeg" => ("jpg", "image/jpeg"),
        "image/png" => ("png", "image/png"),
        _ => return Err("The database contains an unsupported purchase attachment type.".to_owned()),
    };
    let valid_name = reference
        .file_ref
        .strip_prefix(&format!("purchase-{}-", reference.purchase_id))
        .and_then(|suffix| suffix.strip_suffix(&format!(".{expected_extension}")))
        .is_some_and(|stamp| !stamp.is_empty() && stamp.bytes().all(|byte| byte.is_ascii_digit()));
    if !valid_identity
        || !valid_name
        || reference.file_name.trim().is_empty()
        || reference.file_name.len() > 255
        || reference.file_name.contains('/') || reference.file_name.contains('\\')
        || reference.size_bytes == 0
        || reference.size_bytes > MAX_PURCHASE_ATTACHMENT_BYTES
        || !is_sha256_hex(&reference.sha256)
        || expected_mime != reference.mime_type
    {
        return Err("The database contains invalid purchase attachment metadata.".to_owned());
    }
    Ok(())
}

fn read_referenced_attachment(
    directory: &Path,
    reference: &AttachmentReference,
) -> Result<Vec<u8>, String> {
    validate_attachment_reference(reference)?;
    let directory_metadata = fs::symlink_metadata(directory).map_err(|error| {
        format!("Local purchase attachment storage is unavailable: {error}")
    })?;
    if !directory_metadata.file_type().is_dir() {
        return Err("Local purchase attachment storage is not a regular folder.".to_owned());
    }
    let path = directory.join(&reference.file_ref);
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        format!(
            "Purchase attachment {} is unavailable: {error}",
            reference.file_name
        )
    })?;
    if !metadata.file_type().is_file() || metadata.len() != reference.size_bytes {
        return Err(format!(
            "Purchase attachment {} is not a supported regular file.",
            reference.file_name
        ));
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("Could not read purchase attachment {}: {error}", reference.file_name))?;
    if bytes.len() as u64 != reference.size_bytes
        || sha256_hex(&bytes) != reference.sha256
        || !attachment_content_matches(&bytes, &reference.mime_type)
    {
        return Err(format!(
            "Purchase attachment {} is incomplete or corrupt.",
            reference.file_name
        ));
    }
    Ok(bytes)
}

fn attachment_content_matches(bytes: &[u8], mime_type: &str) -> bool {
    match mime_type {
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        _ => false,
    }
}

fn count_orphaned_attachment_files(
    directory: &Path,
    referenced_names: &HashSet<String>,
) -> Result<usize, String> {
    let directory_metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound && referenced_names.is_empty() => {
            return Ok(0)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err("A purchase attachment referenced by the database is missing.".to_owned())
        }
        Err(error) => return Err(format!("Could not inspect local purchase attachment storage: {error}")),
    };
    if !directory_metadata.file_type().is_dir() {
        return Err("Local purchase attachment storage is not a regular folder.".to_owned());
    }
    let mut orphaned_count = 0usize;
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Could not list local purchase attachment storage: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Could not inspect a local purchase attachment: {error}"))?;
        if !entry.file_type()
            .map_err(|error| format!("Could not inspect a local purchase attachment: {error}"))?
            .is_file()
        {
            return Err("Local purchase attachment storage contains an unsupported non-file entry.".to_owned());
        }
        let name = entry.file_name().into_string()
            .map_err(|_| "Local purchase attachment storage contains an invalid filename.".to_owned())?;
        if !referenced_names.contains(&name) {
            orphaned_count = orphaned_count.saturating_add(1);
            if orphaned_count > MAX_BACKUP_ATTACHMENT_COUNT {
                return Err("Local purchase attachment storage contains too many unreferenced files to back up safely.".to_owned());
            }
        }
    }
    Ok(orphaned_count)
}

pub(super) fn validate_attachment_references(
    database_path: &Path,
    attachment_directory: &Path,
) -> Result<usize, String> {
    let references = database_attachment_references(database_path)?;
    for reference in &references {
        read_referenced_attachment(attachment_directory, reference).map_err(|error| {
            format!(
                "A purchase attachment referenced by the database is not safely available on this device ({}): {error}",
                reference.file_name
            )
        })?;
    }
    Ok(references.len())
}

fn photo_archive_path(photo_ref: &str) -> String {
    format!("{PHOTO_ARCHIVE_PREFIX}{photo_ref}")
}

fn attachment_archive_path(file_ref: &str) -> String {
    format!("{ATTACHMENT_ARCHIVE_PREFIX}{file_ref}")
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}