import { listObjects, moveObject, type S3Credentials } from "@/lib/s3-drive-api"

export { formatBytes } from "@/lib/format-bytes"

export async function moveFolderRecursive(credentials: S3Credentials, oldPrefix: string, newPrefix: string) {
    let token: string | undefined
    do {
        const res = await listObjects(credentials, oldPrefix, token, "")
        await Promise.all(
            res.objects.map((obj) =>
                moveObject(credentials, obj.key, newPrefix + obj.key.slice(oldPrefix.length)),
            ),
        )
        token = res.nextContinuationToken
    } while (token)
}
