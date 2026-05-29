import { Module } from '@nestjs/common';

import { ProjectRoutingMemberCreateManyPreQueryHook } from 'src/modules/enso/project-routing-member/query-hooks/project-routing-member-create-many.pre-query-hook';
import { ProjectRoutingMemberCreateOnePreQueryHook } from 'src/modules/enso/project-routing-member/query-hooks/project-routing-member-create-one.pre-query-hook';
import { ProjectRoutingMemberUpdateOnePreQueryHook } from 'src/modules/enso/project-routing-member/query-hooks/project-routing-member-update-one.pre-query-hook';
import { ProjectRoutingMemberNameService } from 'src/modules/enso/project-routing-member/services/project-routing-member-name.service';

@Module({
  providers: [
    ProjectRoutingMemberNameService,
    ProjectRoutingMemberCreateOnePreQueryHook,
    ProjectRoutingMemberCreateManyPreQueryHook,
    ProjectRoutingMemberUpdateOnePreQueryHook,
  ],
})
export class ProjectRoutingMemberQueryHookModule {}
