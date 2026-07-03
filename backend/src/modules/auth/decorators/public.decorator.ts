import { SetMetadata } from '@nestjs/common';

/** Mark an endpoint as accessible without JWT */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
