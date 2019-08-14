const crossSpawn = require('cross-spawn');
const glob = require('glob-all');
const JSZip = require('jszip');
const tape = require('tape');
const {
  chmodSync,
  removeSync,
  readFileSync,
  copySync,
  writeFileSync,
  statSync,
  pathExistsSync
} = require('fs-extra');
const { quote } = require('shell-quote');
const { sep } = require('path');

const { getUserCachePath, sha256Path } = require('./lib/shared');

const initialWorkingDir = process.cwd();

const mkCommand = cmd => (args, options = {}) => {
  const { error, stdout, stderr, status } = crossSpawn.sync(
    cmd,
    args,
    Object.assign(
      {
        env: Object.assign(process.env, { SLS_DEBUG: 't' })
      },
      options
    )
  );
  if (error) {
    console.error(`Error running: ${quote([cmd, ...args])}`); // eslint-disable-line no-console
    throw error;
  }
  if (status) {
    console.error('STDOUT: ', stdout.toString()); // eslint-disable-line no-console
    console.error('STDERR: ', stderr.toString()); // eslint-disable-line no-console
    throw new Error(
      `${quote([cmd, ...args])} failed with status code ${status}`
    );
  }
  return stdout && stdout.toString().trim();
};
const sls = mkCommand('sls');
const git = mkCommand('git');
const npm = mkCommand('npm');
const perl = mkCommand('perl');
const poetry = mkCommand('poetry');

const setup = () => {
  removeSync(getUserCachePath());
};

const teardown = () => {
  [
    'puck',
    'puck2',
    'puck3',
    'node_modules',
    '.serverless',
    '.requirements.zip',
    '.requirements-cache',
    'foobar',
    'package-lock.json',
    'slimPatterns.yml',
    'serverless.yml.bak',
    'module1/foobar',
    getUserCachePath(),
    ...glob.sync('serverless-python-requirements-*.tgz')
  ].map(path => removeSync(path));
  if (!process.cwd().endsWith('base with a space')) {
    git(['checkout', 'serverless.yml']);
  }
  process.chdir(initialWorkingDir);
  removeSync('tests/base with a space');
};

const test = (plan, desc, func, opts = {}) =>
  tape.test(desc, opts, t => {
    setup();
    t.plan(plan);
    try {
      func(t);
    } catch (err) {
      t.fail(err);
      t.end();
    } finally {
      teardown();
    }
  });

const listZipFiles = async filename =>
  Object.keys((await new JSZip().loadAsync(readFileSync(filename))).files);
const listZipFilesWithMetaData = async filename =>
  Object((await new JSZip().loadAsync(readFileSync(filename))).files);
const listRequirementsZipFiles = async filename => {
  const zip = await new JSZip().loadAsync(readFileSync(filename));
  const reqsBuffer = await zip.file('.requirements.zip').async('nodebuffer');
  const reqsZip = await new JSZip().loadAsync(reqsBuffer);
  return Object.keys(reqsZip.files);
};

const canUseDocker = () => {
  if (process.env.GITHUB_ACTION && process.platform === 'win32') return false;
  let result;
  try {
    result = crossSpawn.sync('docker', ['ps']);
  } catch (e) {
    return false;
  }
  return result.status === 0;
};

test(2, 'default pythonBin can package flask with default options', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
  t.end();
});

test(2, 'can package flask with default options', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
  t.end();
});

test(
  1,
  'can package flask with hashes',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--fileName=requirements-w-hashes.txt', 'package']);
    const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.end();
  },
  { skip: process.env.RUNTIME === 'python2.7' }
);

test(3, 'can package flask with zip option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--zip=true', 'package']);
  const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(
    zipfiles.includes('.requirements.zip'),
    'zipped requirements are packaged'
  );
  t.true(zipfiles.includes(`unzip_requirements.py`), 'unzip util is packaged');
  t.false(
    zipfiles.includes(`flask${sep}__init__.py`),
    "flask isn't packaged on its own"
  );
  t.end();
});

test(3, 'can package flask with slim option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--slim=true', 'package']);
  const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.deepEqual(
    zipfiles.filter(filename => filename.endsWith('.pyc')),
    [],
    'no pyc files packaged'
  );
  t.true(
    zipfiles.filter(filename => filename.endsWith('__main__.py')).length > 0,
    '__main__.py files are packaged'
  );
  t.end();
});

/*
 * News tests NOT in test.bats
 */

test(3, 'can package flask with slim & slimPatterns options', async t => {
  process.chdir('tests/base');

  copySync('_slimPatterns.yml', 'slimPatterns.yml');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--slim=true', 'package']);
  const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.deepEqual(
    zipfiles.filter(filename => filename.endsWith('.pyc')),
    [],
    'no pyc files packaged'
  );
  t.deepEqual(
    zipfiles.filter(filename => filename.endsWith('__main__.py')),
    [],
    '__main__.py files are NOT packaged'
  );
  t.end();
});

test(2, "doesn't package bottle with noDeploy option", async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  perl([
    '-p',
    '-i.bak',
    '-e',
    's/(pythonRequirements:$)/\\1\\n    noDeploy: [bottle]/',
    'serverless.yml'
  ]);
  sls(['package']);
  const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.false(zipfiles.includes(`bottle.py`), 'bottle is NOT packaged');
  t.end();
});

test(
  2,
  'can package flask with dockerizePip option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', 'package']);

    const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
    t.end();
  },
  { skip: !canUseDocker() }
);

test(
  3,
  'can package flask with slim & dockerizePip option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', '--slim=true', 'package']);
    const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('.pyc')),
      [],
      '*.pyc files are NOT packaged'
    );
    t.true(
      zipfiles.filter(filename => filename.endsWith('__main__.py')).length > 0,
      '__main__.py files are packaged'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test(
  3,
  'can package flask with slim & dockerizePip & slimPatterns options',
  async t => {
    process.chdir('tests/base');

    copySync('_slimPatterns.yml', 'slimPatterns.yml');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', '--slim=true', 'package']);
    const zipfiles = listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('.pyc')),
      [],
      '*.pyc files are packaged'
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('__main__.py')),
      [],
      '__main__.py files are NOT packaged'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test(
  4,
  'can package flask with zip & dockerizePip option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', '--zip=true', 'package']);

    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    const zippedReqs = await listRequirementsZipFiles(
      '.serverless/sls-py-req-test.zip'
    );
    t.true(
      zipfiles.includes('.requirements.zip'),
      'zipped requirements are packaged'
    );
    t.true(
      zipfiles.includes(`unzip_requirements.py`),
      'unzip util is packaged'
    );
    t.false(
      zipfiles.includes(`flask${sep}__init__.py`),
      "flask isn't packaged on its own"
    );
    t.true(
      zippedReqs.includes(`flask/__init__.py`),
      'flask is packaged in the .requirements.zip file'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test(
  4,
  'can package flask with zip & slim & dockerizePip option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', '--zip=true', '--slim=true', 'package']);

    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    const zippedReqs = await listRequirementsZipFiles(
      '.serverless/sls-py-req-test.zip'
    );
    t.true(
      zipfiles.includes('.requirements.zip'),
      'zipped requirements are packaged'
    );
    t.true(
      zipfiles.includes(`unzip_requirements.py`),
      'unzip util is packaged'
    );
    t.false(
      zipfiles.includes(`flask${sep}__init__.py`),
      "flask isn't packaged on its own"
    );
    t.true(
      zippedReqs.includes(`flask/__init__.py`),
      'flask is packaged in the .requirements.zip file'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test(2, 'pipenv can package flask with default options', async t => {
  process.chdir('tests/pipenv');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
  t.end();
});

test(3, 'pipenv can package flask with slim option', async t => {
  process.chdir('tests/pipenv');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--slim=true', 'package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.deepEqual(
    zipfiles.filter(filename => filename.endsWith('.pyc')),
    [],
    'no pyc files packaged'
  );
  t.true(
    zipfiles.filter(filename => filename.endsWith('__main__.py')).length > 0,
    '__main__.py files are packaged'
  );
  t.end();
});

test(
  3,
  'pipenv can package flask with slim & slimPatterns options',
  async t => {
    process.chdir('tests/pipenv');

    copySync('_slimPatterns.yml', 'slimPatterns.yml');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--slim=true', 'package']);
    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files packaged'
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('__main__.py')),
      [],
      '__main__.py files are NOT packaged'
    );
    t.end();
  }
);

test(3, 'pipenv can package flask with zip option', async t => {
  process.chdir('tests/pipenv');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--zip=true', 'package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(
    zipfiles.includes('.requirements.zip'),
    'zipped requirements are packaged'
  );
  t.true(zipfiles.includes(`unzip_requirements.py`), 'unzip util is packaged');
  t.false(
    zipfiles.includes(`flask${sep}__init__.py`),
    "flask isn't packaged on its own"
  );
  t.end();
});

test(2, "pipenv doesn't package bottle with noDeploy option", async t => {
  process.chdir('tests/pipenv');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  perl([
    '-p',
    '-i.bak',
    '-e',
    's/(pythonRequirements:$)/\\1\\n    noDeploy: [bottle]/',
    'serverless.yml'
  ]);
  sls(['package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.false(zipfiles.includes(`bottle.py`), 'bottle is NOT packaged');
  t.end();
});

test(2, 'non build pyproject.toml uses requirements.txt', async t => {
  process.chdir('tests/non_build_pyproject');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
  t.end();
});

test(3, 'poetry can package flask with default options', async t => {
  process.chdir('tests/poetry');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.true(zipfiles.includes(`bottle.py`), 'bottle is packaged');
  t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
  t.end();
});

test(3, 'poetry can package flask with slim option', async t => {
  process.chdir('tests/poetry');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--slim=true', 'package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.deepEqual(
    zipfiles.filter(filename => filename.endsWith('.pyc')),
    [],
    'no pyc files packaged'
  );
  t.true(
    zipfiles.filter(filename => filename.endsWith('__main__.py')).length > 0,
    '__main__.py files are packaged'
  );
  t.end();
});

test(
  3,
  'poetry can package flask with slim & slimPatterns options',
  async t => {
    process.chdir('tests/poetry');

    copySync('_slimPatterns.yml', 'slimPatterns.yml');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--slim=true', 'package']);
    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files packaged'
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('__main__.py')),
      [],
      '__main__.py files are NOT packaged'
    );
    t.end();
  }
);

test(3, 'poetry can package flask with zip option', async t => {
  process.chdir('tests/poetry');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--zip=true', 'package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(
    zipfiles.includes('.requirements.zip'),
    'zipped requirements are packaged'
  );
  t.true(zipfiles.includes(`unzip_requirements.py`), 'unzip util is packaged');
  t.false(
    zipfiles.includes(`flask${sep}__init__.py`),
    "flask isn't packaged on its own"
  );
  t.end();
});

test(2, "poetry doesn't package bottle with noDeploy option", async t => {
  process.chdir('tests/poetry');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  perl([
    '-p',
    '-i.bak',
    '-e',
    's/(pythonRequirements:$)/\\1\\n    noDeploy: [bottle]/',
    'serverless.yml'
  ]);
  sls(['package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.false(zipfiles.includes(`bottle.py`), 'bottle is NOT packaged');
  t.end();
});

test(
  3,
  'can package flask with zip option and no explicit include',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    perl(['-p', '-i.bak', '-e', 's/include://', 'serverless.yml']);
    perl(['-p', '-i.bak', '-e', 's/^.*handler.py.*$//', 'serverless.yml']);
    sls(['--zip=true', 'package']);
    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(
      zipfiles.includes('.requirements.zip'),
      'zipped requirements are packaged'
    );
    t.true(
      zipfiles.includes(`unzip_requirements.py`),
      'unzip util is packaged'
    );
    t.false(
      zipfiles.includes(`flask${sep}__init__.py`),
      "flask isn't packaged on its own"
    );
    t.end();
  }
);

test(3, 'can package lambda-decorators using vendor option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls([`--vendor=./vendor`, 'package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
  t.true(
    zipfiles.includes(`lambda_decorators.py`),
    'lambda_decorators.py is packaged'
  );
  t.end();
});

test(
  6,
  "Don't nuke execute perms",
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    const perm = '775';

    npm(['i', path]);
    perl([
      '-p',
      '-i.bak',
      '-e',
      's/(handler.py.*$)/$1\n    - foobar/',
      'serverless.yml'
    ]);
    writeFileSync(`foobar`, '');
    chmodSync(`foobar`, perm);
    sls(['--vendor=./vendor', 'package']);

    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
    t.true(
      zipfiles.includes(`lambda_decorators.py`),
      'lambda_decorators.py is packaged'
    );
    t.true(zipfiles.includes(`foobar`), 'foobar is packaged');

    const zipfiles_with_metadata = await listZipFilesWithMetaData(
      '.serverless/sls-py-req-test.zip'
    );
    t.true(
      zipfiles_with_metadata['foobar'].unixPermissions
        .toString(8)
        .slice(3, 6) === perm,
      'foobar has retained its executable file permissions'
    );

    const flaskPerm = statSync('.serverless/requirements/bin/flask').mode;
    t.true(
      zipfiles_with_metadata['bin/flask'].unixPermissions === flaskPerm,
      'bin/flask has retained its executable file permissions'
    );

    t.end();
  },
  { skip: process.platform === 'win32' }
);

test(2, 'can package flask in a project with a space in it', async t => {
  copySync('tests/base', 'tests/base with a space');
  process.chdir('tests/base with a space');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
  t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
  t.end();
});

test(
  2,
  'can package flask in a project with a space in it with docker',
  async t => {
    copySync('tests/base', 'tests/base with a space');
    process.chdir('tests/base with a space');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', 'package']);
    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
    t.end();
  },
  { skip: !canUseDocker() }
);

test(3, 'supports custom file name with fileName option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  writeFileSync('puck', 'requests');
  npm(['i', path]);
  sls(['--fileName=puck', 'package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(
    zipfiles.includes(`requests${sep}__init__.py`),
    'requests is packaged'
  );
  t.false(zipfiles.includes(`flask${sep}__init__.py`), 'flask is NOT packaged');
  t.false(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is NOT packaged');
  t.end();
});

test(5, "doesn't package bottle with zip option", async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  perl([
    '-p',
    '-i.bak',
    '-e',
    's/(pythonRequirements:$)/\\1\\n    noDeploy: [bottle]/',
    'serverless.yml'
  ]);
  sls(['--zip=true', 'package']);
  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  const zippedReqs = await listRequirementsZipFiles(
    '.serverless/sls-py-req-test.zip'
  );
  t.true(
    zipfiles.includes('.requirements.zip'),
    'zipped requirements are packaged'
  );
  t.true(zipfiles.includes(`unzip_requirements.py`), 'unzip util is packaged');
  t.false(
    zipfiles.includes(`flask${sep}__init__.py`),
    "flask isn't packaged on its own"
  );
  t.true(
    zippedReqs.includes(`flask/__init__.py`),
    'flask is packaged in the .requirements.zip file'
  );
  t.false(
    zippedReqs.includes(`bottle.py`),
    'bottle is NOT packaged in the .requirements.zip file'
  );
  t.end();
});

test(
  4,
  'can package flask with slim, slimPatterns & slimPatternsAppendDefaults=false options',
  async t => {
    process.chdir('tests/base');
    copySync('_slimPatterns.yml', 'slimPatterns.yml');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--slim=true', '--slimPatternsAppendDefaults=false', 'package']);

    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(
      zipfiles.filter(filename => filename.endsWith('.pyc')).length >= 1,
      'pyc files are packaged'
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('__main__.py')),
      [],
      '__main__.py files are NOT packaged'
    );
    t.end();
  }
);

test(
  3,
  'can package flask with slim & dockerizePip & slimPatterns & slimPatternsAppendDefaults=false options',
  async t => {
    process.chdir('tests/base');
    copySync('_slimPatterns.yml', 'slimPatterns.yml');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls([
      '--dockerizePip=true',
      '--slim=true',
      '--slimPatternsAppendDefaults=false',
      'package'
    ]);

    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(
      zipfiles.filter(filename => filename.endsWith('.pyc')).length >= 1,
      'pyc files are packaged'
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('__main__.py')),
      [],
      '__main__.py files are NOT packaged'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test(
  3,
  'pipenv can package flask with slim & slimPatterns & slimPatternsAppendDefaults=false  option',
  async t => {
    process.chdir('tests/pipenv');
    copySync('_slimPatterns.yml', 'slimPatterns.yml');
    const path = npm(['pack', '../..']);
    npm(['i', path]);

    sls(['--slim=true', '--slimPatternsAppendDefaults=false', 'package']);
    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(
      zipfiles.filter(filename => filename.endsWith('.pyc')).length >= 1,
      'pyc files are packaged'
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('__main__.py')),
      [],
      '__main__.py files are NOT packaged'
    );
    t.end();
  }
);

test(
  3,
  'poetry can package flask with slim & slimPatterns & slimPatternsAppendDefaults=false  option',
  async t => {
    process.chdir('tests/poetry');
    copySync('_slimPatterns.yml', 'slimPatterns.yml');
    const path = npm(['pack', '../..']);
    npm(['i', path]);

    sls(['--slim=true', '--slimPatternsAppendDefaults=false', 'package']);
    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(
      zipfiles.filter(filename => filename.endsWith('.pyc')).length >= 1,
      'pyc files are packaged'
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('__main__.py')),
      [],
      '__main__.py files are NOT packaged'
    );
    t.end();
  }
);

test(16, 'can package flask with package individually option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--individually=true', 'package']);

  const zipfiles_hello = await listZipFiles('.serverless/hello.zip');
  t.false(
    zipfiles_hello.includes(`fn2${sep}__init__.py`),
    'fn2 is NOT packaged in function hello'
  );
  t.true(
    zipfiles_hello.includes('handler.py'),
    'handler.py is packaged in function hello'
  );
  t.false(
    zipfiles_hello.includes(`dataclasses.py`),
    'dataclasses is NOT packaged in function hello'
  );
  t.true(
    zipfiles_hello.includes(`flask${sep}__init__.py`),
    'flask is packaged in function hello'
  );

  const zipfiles_hello2 = await listZipFiles('.serverless/hello2.zip');
  t.false(
    zipfiles_hello2.includes(`fn2${sep}__init__.py`),
    'fn2 is NOT packaged in function hello2'
  );
  t.true(
    zipfiles_hello2.includes('handler.py'),
    'handler.py is packaged in function hello2'
  );
  t.false(
    zipfiles_hello2.includes(`dataclasses.py`),
    'dataclasses is NOT packaged in function hello2'
  );
  t.true(
    zipfiles_hello2.includes(`flask${sep}__init__.py`),
    'flask is packaged in function hello2'
  );

  const zipfiles_hello3 = await listZipFiles('.serverless/hello3.zip');
  t.false(
    zipfiles_hello3.includes(`fn2${sep}__init__.py`),
    'fn2 is NOT packaged in function hello3'
  );
  t.true(
    zipfiles_hello3.includes('handler.py'),
    'handler.py is packaged in function hello3'
  );
  t.false(
    zipfiles_hello3.includes(`dataclasses.py`),
    'dataclasses is NOT packaged in function hello3'
  );
  t.false(
    zipfiles_hello3.includes(`flask${sep}__init__.py`),
    'flask is NOT packaged in function hello3'
  );

  const zipfiles_hello4 = await listZipFiles(
    '.serverless/fn2-sls-py-req-test-dev-hello4.zip'
  );
  t.false(
    zipfiles_hello4.includes(`fn2${sep}__init__.py`),
    'fn2 is NOT packaged in function hello4'
  );
  t.true(
    zipfiles_hello4.includes('fn2_handler.py'),
    'fn2_handler is packaged in the zip-root in function hello4'
  );
  t.true(
    zipfiles_hello4.includes(`dataclasses.py`),
    'dataclasses is packaged in function hello4'
  );
  t.false(
    zipfiles_hello4.includes(`flask${sep}__init__.py`),
    'flask is NOT packaged in function hello4'
  );

  t.end();
});

test(
  15,
  'can package flask with package individually & slim option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--individually=true', '--slim=true', 'package']);

    const zipfiles_hello = await listZipFiles('.serverless/hello.zip');
    t.true(
      zipfiles_hello.includes('handler.py'),
      'handler.py is packaged in function hello'
    );
    t.deepEqual(
      zipfiles_hello.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files packaged in function hello'
    );
    t.true(
      zipfiles_hello.includes(`flask${sep}__init__.py`),
      'flask is packaged in function hello'
    );
    t.false(
      zipfiles_hello.includes(`dataclasses.py`),
      'dataclasses is NOT packaged in function hello'
    );

    const zipfiles_hello2 = await listZipFiles('.serverless/hello2.zip');
    t.true(
      zipfiles_hello2.includes('handler.py'),
      'handler.py is packaged in function hello2'
    );
    t.deepEqual(
      zipfiles_hello2.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files packaged in function hello2'
    );
    t.true(
      zipfiles_hello2.includes(`flask${sep}__init__.py`),
      'flask is packaged in function hello2'
    );
    t.false(
      zipfiles_hello2.includes(`dataclasses.py`),
      'dataclasses is NOT packaged in function hello2'
    );

    const zipfiles_hello3 = await listZipFiles('.serverless/hello3.zip');
    t.true(
      zipfiles_hello3.includes('handler.py'),
      'handler.py is packaged in function hello3'
    );
    t.deepEqual(
      zipfiles_hello3.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files packaged in function hello3'
    );
    t.false(
      zipfiles_hello3.includes(`flask${sep}__init__.py`),
      'flask is NOT packaged in function hello3'
    );

    const zipfiles_hello4 = await listZipFiles(
      '.serverless/fn2-sls-py-req-test-dev-hello4.zip'
    );
    t.true(
      zipfiles_hello4.includes('fn2_handler.py'),
      'fn2_handler is packaged in the zip-root in function hello4'
    );
    t.true(
      zipfiles_hello4.includes(`dataclasses.py`),
      'dataclasses is packaged in function hello4'
    );
    t.false(
      zipfiles_hello4.includes(`flask${sep}__init__.py`),
      'flask is NOT packaged in function hello4'
    );
    t.deepEqual(
      zipfiles_hello4.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files packaged in function hello4'
    );

    t.end();
  }
);

test(8, 'can package only requirements of module', async t => {
  process.chdir('tests/individually');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);

  const zipfiles_hello = await listZipFiles(
    '.serverless/module1-sls-py-req-test-indiv-dev-hello1.zip'
  );
  t.true(
    zipfiles_hello.includes('handler1.py'),
    'handler1.py is packaged at root level in function hello1'
  );
  t.false(
    zipfiles_hello.includes('handler2.py'),
    'handler2.py is NOT packaged at root level in function hello1'
  );
  t.true(
    zipfiles_hello.includes(`pyaml${sep}__init__.py`),
    'pyaml is packaged in function hello1'
  );
  t.false(
    zipfiles_hello.includes(`flask${sep}__init__.py`),
    'flask is NOT packaged in function hello1'
  );

  const zipfiles_hello2 = await listZipFiles(
    '.serverless/module2-sls-py-req-test-indiv-dev-hello2.zip'
  );
  t.true(
    zipfiles_hello2.includes('handler2.py'),
    'handler2.py is packaged at root level in function hello2'
  );
  t.false(
    zipfiles_hello2.includes('handler1.py'),
    'handler1.py is NOT packaged at root level in function hello2'
  );
  t.false(
    zipfiles_hello2.includes(`pyaml${sep}__init__.py`),
    'pyaml is NOT packaged in function hello2'
  );
  t.true(
    zipfiles_hello2.includes(`flask${sep}__init__.py`),
    'flask is packaged in function hello2'
  );

  t.end();
});

test(
  15,
  'can package lambda-decorators using vendor and invidiually option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--individually=true', '--vendor=./vendor', 'package']);

    const zipfiles_hello = await listZipFiles('.serverless/hello.zip');
    t.true(
      zipfiles_hello.includes('handler.py'),
      'handler.py is packaged at root level in function hello'
    );
    t.true(
      zipfiles_hello.includes(`flask${sep}__init__.py`),
      'flask is packaged in function hello'
    );
    t.true(
      zipfiles_hello.includes(`lambda_decorators.py`),
      'lambda_decorators.py is packaged in function hello'
    );
    t.false(
      zipfiles_hello.includes(`dataclasses.py`),
      'dataclasses is NOT packaged in function hello'
    );

    const zipfiles_hello2 = await listZipFiles('.serverless/hello2.zip');
    t.true(
      zipfiles_hello2.includes('handler.py'),
      'handler.py is packaged at root level in function hello2'
    );
    t.true(
      zipfiles_hello2.includes(`flask${sep}__init__.py`),
      'flask is packaged in function hello2'
    );
    t.true(
      zipfiles_hello2.includes(`lambda_decorators.py`),
      'lambda_decorators.py is packaged in function hello2'
    );
    t.false(
      zipfiles_hello2.includes(`dataclasses.py`),
      'dataclasses is NOT packaged in function hello2'
    );

    const zipfiles_hello3 = await listZipFiles('.serverless/hello3.zip');
    t.true(
      zipfiles_hello3.includes('handler.py'),
      'handler.py is packaged at root level in function hello3'
    );
    t.false(
      zipfiles_hello3.includes(`flask${sep}__init__.py`),
      'flask is NOT packaged in function hello3'
    );
    t.false(
      zipfiles_hello3.includes(`lambda_decorators.py`),
      'lambda_decorators.py is NOT packaged in function hello3'
    );
    t.false(
      zipfiles_hello3.includes(`dataclasses.py`),
      'dataclasses is NOT packaged in function hello3'
    );

    const zipfiles_hello4 = await listZipFiles(
      '.serverless/fn2-sls-py-req-test-dev-hello4.zip'
    );
    t.true(
      zipfiles_hello4.includes('fn2_handler.py'),
      'fn2_handler is packaged in the zip-root in function hello4'
    );
    t.true(
      zipfiles_hello4.includes(`dataclasses.py`),
      'dataclasses is packaged in function hello4'
    );
    t.false(
      zipfiles_hello4.includes(`flask${sep}__init__.py`),
      'flask is NOT packaged in function hello4'
    );
    t.end();
  }
);

test(
  2,
  "Don't nuke execute perms when using individually",
  async t => {
    process.chdir('tests/individually');
    const path = npm(['pack', '../..']);
    const perm = '775';
    writeFileSync(`module1${sep}foobar`, '');
    chmodSync(`module1${sep}foobar`, perm);

    npm(['i', path]);
    sls(['package']);

    const zipfiles_hello1 = await listZipFilesWithMetaData(
      '.serverless/hello1.zip'
    );

    t.true(
      zipfiles_hello1['module1/foobar'].unixPermissions
        .toString(8)
        .slice(3, 6) === perm,
      'foobar has retained its executable file permissions'
    );

    const zipfiles_hello2 = await listZipFilesWithMetaData(
      '.serverless/module2-sls-py-req-test-indiv-dev-hello2.zip'
    );
    const flaskPerm = statSync('.serverless/module2/requirements/bin/flask')
      .mode;

    t.true(
      zipfiles_hello2['bin/flask'].unixPermissions === flaskPerm,
      'bin/flask has retained its executable file permissions'
    );

    t.end();
  },
  { skip: process.platform === 'win32' }
);

test(
  2,
  "Don't nuke execute perms when using individually w/docker",
  async t => {
    process.chdir('tests/individually');
    const path = npm(['pack', '../..']);
    const perm = '775';
    writeFileSync(`module1${sep}foobar`, '', { mode: perm });
    chmodSync(`module1${sep}foobar`, perm);

    npm(['i', path]);
    sls(['--dockerizePip=true', 'package']);

    const zipfiles_hello = await listZipFilesWithMetaData(
      '.serverless/hello1.zip'
    );

    t.true(
      zipfiles_hello['module1/foobar'].unixPermissions
        .toString(8)
        .slice(3, 6) === perm,
      'foobar has retained its executable file permissions'
    );

    const zipfiles_hello2 = await listZipFilesWithMetaData(
      '.serverless/module2-sls-py-req-test-indiv-dev-hello2.zip'
    );
    const flaskPerm = statSync('.serverless/module2/requirements/bin/flask')
      .mode;

    t.true(
      zipfiles_hello2['bin/flask'].unixPermissions === flaskPerm,
      'bin/flask has retained its executable file permissions'
    );

    t.end();
  },
  { skip: !canUseDocker() }
);

test(1, 'uses download cache by default option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const cachepath = getUserCachePath();
  t.true(
    pathExistsSync(`${cachepath}${sep}downloadCacheslspyc${sep}http`),
    'cache directoy exists'
  );
  t.end();
});

test(1, 'uses download cache by defaul option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['--cacheLocation=.requirements-cache', 'package']);
  t.true(
    pathExistsSync(`.requirements-cache${sep}downloadCacheslspyc${sep}http`),
    'cache directoy exists'
  );
  t.end();
});

test(
  1,
  'uses download cache with dockerizePip option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', 'package']);
    const cachepath = getUserCachePath();
    t.true(
      pathExistsSync(`${cachepath}${sep}downloadCacheslspyc${sep}http`),
      'cache directoy exists'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test(
  1,
  'uses download cache with dockerizePip by default option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls([
      '--dockerizePip=true',
      '--cacheLocation=.requirements-cache',
      'package'
    ]);
    t.true(
      pathExistsSync(`.requirements-cache${sep}downloadCacheslspyc${sep}http`),
      'cache directoy exists'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test(2, 'uses static and download cache', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const cachepath = getUserCachePath();
  const cacheFolderHash = sha256Path('.serverless/requirements.txt');
  t.true(
    pathExistsSync(`${cachepath}${sep}downloadCacheslspyc${sep}http`),
    'http exists in download-cache'
  );
  t.true(
    pathExistsSync(`${cachepath}${sep}${cacheFolderHash}_slspyc${sep}flask`),
    'flask exists in static-cache'
  );
  t.end();
});

test(
  2,
  'uses static and download cache with dockerizePip option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', 'package']);
    const cachepath = getUserCachePath();
    const cacheFolderHash = sha256Path('.serverless/requirements.txt');
    t.true(
      pathExistsSync(`${cachepath}${sep}downloadCacheslspyc${sep}http`),
      'http exists in download-cache'
    );
    t.true(
      pathExistsSync(`${cachepath}${sep}${cacheFolderHash}_slspyc${sep}flask`),
      'flask exists in static-cache'
    );
    t.end();
  },
  { skip: !canUseDocker() }
);

test('uses static cache', async t => {
  3, process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  sls(['package']);
  const cachepath = getUserCachePath();
  const cacheFolderHash = sha256Path('.serverless/requirements.txt');
  t.true(
    pathExistsSync(`${cachepath}${sep}${cacheFolderHash}_slspyc${sep}flask`),
    'flask exists in static-cache'
  );
  t.true(
    pathExistsSync(
      `${cachepath}${sep}${cacheFolderHash}_slspyc${sep}.completed_requirements`
    ),
    '.completed_requirements exists in static-cache'
  );

  // checking that static cache actually pulls from cache (by poisoning it)
  writeFileSync(
    `${cachepath}${sep}${cacheFolderHash}_slspyc${sep}injected_file_is_bad_form`,
    'injected new file into static cache folder'
  );
  sls(['package']);

  const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
  t.true(
    zipfiles.includes('injected_file_is_bad_form'),
    "static cache is really used when running 'sls package' again"
  );

  t.end();
});

test(2, 'uses static cache with cacheLocation option', async t => {
  process.chdir('tests/base');
  const path = npm(['pack', '../..']);
  npm(['i', path]);
  const cachepath = '.requirements-cache';
  sls([`--cacheLocation=${cachepath}`, 'package']);
  const cacheFolderHash = sha256Path('.serverless/requirements.txt');
  t.true(
    pathExistsSync(`${cachepath}${sep}${cacheFolderHash}_slspyc${sep}flask`),
    'flask exists in static-cache'
  );
  t.true(
    pathExistsSync(
      `${cachepath}${sep}${cacheFolderHash}_slspyc${sep}.completed_requirements`
    ),
    '.completed_requirements exists in static-cache'
  );
  t.end();
});

test(
  4,
  'uses static cache with dockerizePip & slim option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', '--slim=true', 'package']);
    const cachepath = getUserCachePath();
    const cacheFolderHash = sha256Path('.serverless/requirements.txt');
    t.true(
      pathExistsSync(`${cachepath}${sep}${cacheFolderHash}_slspyc${sep}flask`),
      'flask exists in static-cache'
    );
    t.true(
      pathExistsSync(
        `${cachepath}${sep}${cacheFolderHash}_slspyc${sep}.completed_requirements`
      ),
      '.completed_requirements exists in static-cache'
    );

    // checking that static cache actually pulls from cache (by poisoning it)
    writeFileSync(
      `${cachepath}${sep}${cacheFolderHash}_slspyc${sep}injected_file_is_bad_form`,
      'injected new file into static cache folder'
    );
    sls(['--dockerizePip=true', '--slim=true', 'package']);

    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(
      zipfiles.includes('injected_file_is_bad_form'),
      "static cache is really used when running 'sls package' again"
    );
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files are packaged'
    );

    t.end();
  },
  { skip: !canUseDocker() }
);

test(
  3,
  'uses download cache with dockerizePip & slim option',
  async t => {
    process.chdir('tests/base');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    sls(['--dockerizePip=true', '--slim=true', 'package']);
    const cachepath = getUserCachePath();
    t.true(
      pathExistsSync(`${cachepath}${sep}downloadCacheslspyc${sep}http`),
      'http exists in download-cache'
    );

    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.deepEqual(
      zipfiles.filter(filename => filename.endsWith('.pyc')),
      [],
      'no pyc files are packaged'
    );

    t.end();
  },
  { skip: !canUseDocker() }
);

// From this point on, the version of the poetry is 1.0.0a0
test(
  3,
  'poetry1.0.0a0 py3.6 can package flask with default options',
  async t => {
    process.chdir('tests/poetry');
    const path = npm(['pack', '../..']);
    npm(['i', path]);
    poetry(['self', 'update', '--preview', '1.0.0a0']);
    sls(['package']);
    const zipfiles = await listZipFiles('.serverless/sls-py-req-test.zip');
    t.true(zipfiles.includes(`flask${sep}__init__.py`), 'flask is packaged');
    t.true(zipfiles.includes(`bottle.py`), 'bottle is packaged');
    t.true(zipfiles.includes(`boto3${sep}__init__.py`), 'boto3 is packaged');
    t.end();
  }
);
