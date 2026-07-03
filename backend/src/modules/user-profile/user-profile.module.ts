import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation, Message, UserProfile } from '../../database/entities';
import { UserProfileService } from './services/profile.service';
import { ProfileRefinerService } from './services/profile-refiner.service';
import { UserProfileController } from './controllers/user-profile.controller';

/**
 * @Global — UserProfileService 被 Planner 注入；ProfileRefinerService 被 ChatService 注入
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserProfile, Conversation, Message])],
  providers: [UserProfileService, ProfileRefinerService],
  controllers: [UserProfileController],
  exports: [UserProfileService, ProfileRefinerService],
})
export class UserProfileModule {}
