<?php

namespace App\Enums;

enum OrganizationRole: string
{
    case Admin = 'admin';
    case Member = 'member';
    case Viewer = 'viewer';
}
