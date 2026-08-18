import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { ProjectRole } from '../project-permissions';

export class AddProjectMemberDto {
  @ApiProperty({
    example: 'teammate@example.com',
    description: 'They must already have a Raven account — there is no invitation flow yet.',
  })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    enum: ProjectRole,
    default: ProjectRole.DEVELOPER,
    description: 'Only an owner may grant the owner role.',
  })
  @IsOptional()
  @IsEnum(ProjectRole)
  role?: ProjectRole;
}

export class UpdateProjectMemberDto {
  @ApiProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
