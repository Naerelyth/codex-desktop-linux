//! Package identity comes from a root-owned package resource, never caller env.

use anyhow::{Context, Result};
use std::{fs, io::ErrorKind, os::unix::fs::MetadataExt, path::Path, sync::OnceLock};

const RESOURCE: &str = "/usr/share/codex-update-manager/identity";
static IDENTITY: OnceLock<Identity> = OnceLock::new();

#[cfg(test)]
thread_local! {
    static TEST_IDENTITY: std::cell::Cell<Option<Identity>> = const { std::cell::Cell::new(None) };
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Identity {
    #[default]
    Community,
    Upstream,
}

impl Identity {
    fn parse(value: &str) -> Result<Self> {
        match value.trim() {
            "community" => Ok(Self::Community),
            "upstream" => Ok(Self::Upstream),
            _ => anyhow::bail!("Invalid packaged updater identity"),
        }
    }

    pub fn mode(self) -> &'static str {
        match self {
            Self::Community => "community",
            Self::Upstream => "upstream",
        }
    }

    pub fn package_name(self) -> &'static str {
        match self {
            Self::Community => "codex-desktop",
            Self::Upstream => "chatgpt",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Community => "ChatGPT Community",
            Self::Upstream => "ChatGPT",
        }
    }

    pub fn state_name(self) -> &'static str {
        match self {
            Self::Community => "codex-update-manager",
            Self::Upstream => "chatgpt-update-manager",
        }
    }
}

fn read_identity(path: &Path) -> Result<Identity> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Identity::Community),
        Err(error) => return Err(error).context("Could not open updater identity"),
    };
    let metadata = file.metadata()?;
    anyhow::ensure!(
        metadata.is_file() && metadata.uid() == 0 && metadata.mode() & 0o022 == 0,
        "Updater identity resource must be a root-owned, non-writable regular file"
    );
    use std::io::Read;
    let mut value = String::new();
    file.read_to_string(&mut value)?;
    Identity::parse(&value)
}

pub fn initialize() -> Result<()> {
    let identity = read_identity(Path::new(RESOURCE))?;
    IDENTITY
        .set(identity)
        .map_err(|_| anyhow::anyhow!("Updater identity initialized twice"))
}

pub fn current() -> Identity {
    #[cfg(test)]
    if let Some(identity) = TEST_IDENTITY.get() {
        return identity;
    }
    *IDENTITY.get().unwrap_or(&Identity::Community)
}
pub fn package_name() -> &'static str {
    current().package_name()
}

#[cfg(test)]
pub fn with_identity<T>(identity: Identity, run: impl FnOnce() -> T) -> T {
    struct Restore(Option<Identity>);
    impl Drop for Restore {
        fn drop(&mut self) {
            TEST_IDENTITY.set(self.0);
        }
    }
    let _restore = Restore(TEST_IDENTITY.replace(Some(identity)));
    run()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_controls_package_and_state_without_changing_feature_selection() -> Result<()> {
        let upstream = Identity::parse("upstream\n")?;
        assert_eq!(upstream.package_name(), "chatgpt");
        assert_eq!(upstream.display_name(), "ChatGPT");
        assert_eq!(upstream.state_name(), "chatgpt-update-manager");
        assert_eq!(Identity::Community.package_name(), "codex-desktop");
        assert!(Identity::parse("other-package").is_err());
        Ok(())
    }

    #[test]
    fn legacy_install_without_identity_resource_stays_community() -> Result<()> {
        let temp = tempfile::tempdir()?;
        assert_eq!(
            read_identity(&temp.path().join("absent"))?,
            Identity::Community
        );
        assert!(read_identity(temp.path()).is_err());
        Ok(())
    }
}
