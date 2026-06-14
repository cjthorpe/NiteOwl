function readPackage(pkg, context) {
  if (pkg.name === 'msgpackr-extract') {
    pkg.pnpm = pkg.pnpm || {};
    pkg.pnpm.allowNonApplied = true;
  }
  return pkg;
}

module.exports = {
  hooks: {
    readPackage
  }
}
