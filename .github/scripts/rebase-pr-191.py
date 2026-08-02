from pathlib import Path

package_path = Path('package.json')
package = package_path.read_text()
registered = 'src/operations/transaction.integration.test.ts src/operations/rollback-metadata.integration.test.ts src/service/service-manager.test.ts'
if registered not in package:
    before = 'src/operations/transaction.integration.test.ts src/service/service-manager.test.ts'
    if package.count(before) != 1:
        raise SystemExit('Expected integration-test registration point was not found exactly once')
    package = package.replace(before, registered)
package_path.write_text(package)
