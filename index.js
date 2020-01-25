const core = require('@actions/core');
const exec = require("@actions/exec");
const eol = require('os').EOL;

const cmd = async (command, ...args) => {
  let output = '';
  const options = {
    silent: true
  };
  options.listeners = {
    stdout: (data) => { output += data.toString(); }
  };

  await exec.exec(command, args, options)
    .catch(err => { core.error(`${command} ${args.join(' ')} failed: ${err}`); throw err; });
  return output;
};

const setOutput = (major, minor, patch, increment, changed) => {
  const format = core.getInput('format', { required: true });
  var version = format
    .replace('${major}', major)
    .replace('${minor}', minor)
    .replace('${patch}', patch)
    .replace('${increment}', increment);

  core.info(`Version is ${major}.${minor}.${patch}+${increment}`);
  core.info(`To create a release for this `)
  core.setOutput("version", version);
  core.setOutput("major", major.toString());
  core.setOutput("minor", minor.toString());
  core.setOutput("patch", patch.toString());
  core.setOutput("increment", increment.toString());
  core.setOutput("changed", changed.toString());
};

async function run() {
  try {
    const remote = await cmd('git', 'remote');
    const remoteExists = remote !== '';
    const remotePrefix = remoteExists ? 'origin/' : '';

    const tagPrefix = core.getInput('tag_prefix') || '';
    const branch = `${remotePrefix}${core.getInput('branch', { required: true })}`;
    const majorPattern = core.getInput('major_pattern', { required: true });
    const minorPattern = core.getInput('minor_pattern', { required: true });
    const changePath = core.getInput('change_path') || '';

    const releasePattern = `${tagPrefix}*`;
    let major = 0, minor = 0, patch = 0, increment = 0;
    let changed = true;


    let lastCommitAll = (await cmd('git', 'rev-list', '-n1', '--all')).trim();

    if (lastCommitAll === '') {
      // empty repo
      setOutput('0', '0', '0', '0', changed);
      return;
    }

    //let commit = (await cmd('git', 'rev-parse', 'HEAD')).trim();

    let tag = '';
    try {
      tag = (await cmd(
        'git',
        `describe`,
        `--tags`,
        `--abbrev=0`,
        `--match=${releasePattern}`,
        `${branch}~1`
      )).trim();
    }
    catch (err) {
      tag = '';
    }

    let root;
    if (tag === '') {
      if (remoteExists) {
        core.warning('No tags are present for this repository. If this is unexpected, check to ensure that tags have been pulled from the remote.');
      }
      // no release tags yet, use the initial commit as the root
      root = '';
    } else {
      // parse the version tag
      let tagParts = tag.split('/');
      let versionValues = tagParts[tagParts.length - 1]
        .substr(tagPrefix.length)
        .split('.');

      major = parseInt(versionValues[0]);
      minor = versionValues.length > 1 ? parseInt(versionValues[1]) : 0;
      patch = versionValues.length > 2 ? parseInt(versionValues[2]) : 0;

      if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
        throw `Invalid tag ${tag}`;
      }

      root = await cmd('git', `merge-base`, tag, branch);
    }
    root = root.trim();

    const log = await cmd(
      'git',
      'log',
      '--pretty="%s"',
      '--author-date-order',
      root === '' ? branch : `${root}..${branch}`);

    if (changePath !== '') {
      const changedFiles = await cmd(`git diff --name-only ${root}..${branch} -- ${changePath}`);

      changed = changedFiles.length > 0;
    }

    let history = log
      .trim()
      .split(eol)
      .reverse();

    // Discover the change time from the history log by finding the oldest log
    // that could set the version.

    const majorIndex = history.findIndex(x => x.includes(majorPattern));
    const minorIndex = history.findIndex(x => x.includes(minorPattern));

    if (majorIndex !== -1) {
      increment = history.length - (majorIndex + 1);
      patch = 0;
      minor = 0;
      major++;
    } else if (minorIndex !== -1) {
      increment = history.length - (minorIndex + 1);
      patch = 0;
      minor++;
    } else {
      increment = history.length - 1;
      patch++;
    }

    setOutput(major, minor, patch, increment, changed);

  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

run();