import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { SelectedPhoto } from "@/types/visit-photos";
import { stripJpegMetadata } from "@/lib/photo-jpeg";

export const MAX_VISIT_PHOTOS = 12;
export const MAX_PHOTO_SELECTION = 6;
// Persist relative names: iOS may change the sandbox's absolute path on rebuild.
export function photoFile(userId: string, name: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(userId) || !/^[a-f0-9-]+-(image|thumbnail)\.jpg$/.test(name)) throw new Error("Invalid local photo.");
    return new File(Paths.document, "visit-photo-drafts", userId, name);
}
export async function releasePhotoCopies(userId: string, asset: SelectedPhoto) {
    for (const name of [asset.image, asset.thumbnail]) {
        const file = photoFile(userId, name);
        if (file.exists) file.delete();
    }
}
export async function selectVisitPhotos(userId: string, remaining: number): Promise<SelectedPhoto[]> {
    const limit = Math.min(MAX_PHOTO_SELECTION, remaining);
    if (limit < 1) return [];
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: limit,
        orderedSelection: true, allowsEditing: false, exif: false, base64: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return [];
    const directory = new Directory(Paths.document, "visit-photo-drafts", userId);
    directory.create({ intermediates: true, idempotent: true });
    const photos: SelectedPhoto[] = [];
    for (const asset of result.assets.slice(0, limit)) {
        if (!asset.width || !asset.height) throw new Error("This photo could not be opened. Choose another image.");
        const id = randomUUID();
        const context = ImageManipulator.manipulate(asset.uri);
        const scale = Math.min(1, 1600 / Math.max(asset.width, asset.height));
        context.resize({ width: Math.max(1, Math.round(asset.width * scale)), height: Math.max(1, Math.round(asset.height * scale)) });
        const rendered = await context.renderAsync();
        // Normalize HEIC/orientation before removing metadata from both JPEGs.
        const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
        const thumbnailContext = ImageManipulator.manipulate(image.uri);
        const thumbScale = Math.min(1, 480 / Math.max(image.width, image.height));
        thumbnailContext.resize({ width: Math.max(1, Math.round(image.width * thumbScale)), height: Math.max(1, Math.round(image.height * thumbScale)) });
        const thumbnailRef = await thumbnailContext.renderAsync();
        const thumbnail = await thumbnailRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.72 });
        const imageName = `${id}-image.jpg`, thumbnailName = `${id}-thumbnail.jpg`;
        const full = photoFile(userId, imageName), thumb = photoFile(userId, thumbnailName);
        full.write(stripJpegMetadata(new Uint8Array(await new File(image.uri).arrayBuffer())));
        thumb.write(stripJpegMetadata(new Uint8Array(await new File(thumbnail.uri).arrayBuffer())));
        context.release(); rendered.release(); thumbnailContext.release(); thumbnailRef.release();
        if (full.size > 5 * 1024 * 1024 || thumb.size > 512 * 1024) throw new Error("This photo is too large. Choose another image.");
        photos.push({ id, image: imageName, thumbnail: thumbnailName, width: image.width, height: image.height,
            bytes: full.size, thumbnailBytes: thumb.size });
    }
    return photos;
}
