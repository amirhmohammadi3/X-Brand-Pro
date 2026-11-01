import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { MEDIA_MAX_BYTES_ANY, mediaKindSchema, type MediaKind } from '@app/contracts';
import { zodValidationError } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { uuidSchema } from '@app/contracts';
import type { MediaService } from './media.service.js';
import { MEDIA_SERVICE } from './media.service.js';

/** Shape JwtAuthGuard attaches to the request (B1.3). */
interface RequestUser {
  id: string;
  role: string;
  status: string;
  sessionId: string;
}

/**
 * Upload + owner deletion (B1.9). Authentication comes from the global
 * JwtAuthGuard (no @Public here). Multipart is parsed by multer with MEMORY
 * storage and a hard cap of the largest per-kind limit; the per-kind limit is
 * enforced in MediaService once `kind` is known (multipart field order makes
 * kind-before-file unreliable, so the first-line cap is the global max).
 * multer's LIMIT_FILE_SIZE maps to 413 by @nestjs/platform-express itself.
 */
@Controller('media')
export class MediaController {
  constructor(@Inject(MEDIA_SERVICE) private readonly media: MediaService) {}

  @RateLimit({
    name: 'media.upload',
    limit: 30,
    windowSec: 3600,
    scope: 'user',
    failClosed: true,
  })
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MEDIA_MAX_BYTES_ANY, files: 1 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('kind') kind: unknown,
    @Req() req: Request,
  ) {
    const user = (req as Request & { user?: RequestUser }).user;
    if (!user) throw new ForbiddenException('Authentication required');

    const parsedKind = mediaKindSchema.safeParse(kind);
    if (!parsedKind.success) {
      throw zodValidationError(parsedKind.error);
    }

    if (!file || !(file.buffer instanceof Buffer) || file.buffer.length === 0) {
      throw new UnprocessableEntityException('Missing file field "file"');
    }

    // The prompt reserves business_photo for owners/admins until B2.7 adds
    // the real attach-time authorization.
    if (parsedKind.data === 'business_photo') {
      const allowed = ['owner', 'admin', 'super_admin'];
      if (!allowed.includes(user.role)) {
        throw new ForbiddenException('business_photo requires an owner or admin role');
      }
    }

    return this.media.saveImage(
      { buffer: file.buffer, originalName: file.originalname, size: file.size },
      { kind: parsedKind.data as MediaKind, ownerId: user.id },
    );
  }

  /** Owner of the file (or an admin) soft-deletes it; files removed by worker. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    const user = (req as Request & { user?: RequestUser }).user;
    if (!user) throw new ForbiddenException('Authentication required');
    if (!uuidSchema.safeParse(id).success) {
      throw new UnprocessableEntityException('Invalid media id');
    }
    await this.media.deleteOwned(id, { id: user.id, role: user.role });
    return { deleted: true };
  }
}
