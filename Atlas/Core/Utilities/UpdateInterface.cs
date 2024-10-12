﻿using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Documents;
using Atlas.UI;
using System.Web;
using SQLitePCL;
using Atlas.Core.Database;
using System.Security.Cryptography.X509Certificates;

namespace Atlas.Core.Utilities
{
    public static class UpdateInterface
    {
        public static bool UpdateCompleted = false;
        public static async Task<Task> ParseUpdate(string data)
        {            
            JObject dataObj = JObject.Parse(data);
            InterfaceHelper.SplashWindow.Dispatcher.Invoke((Action)(() =>
            {
                InterfaceHelper.SplashProgressBar.Value = 100;
            }));
            //This to to make sure the update was processed
            System.Threading.Thread.Sleep(1000);

            //We have to import atlas data before we import f95 data 

            InterfaceHelper.SplashWindow.Dispatcher.Invoke((Action)(() =>
            {
                InterfaceHelper.SplashProgressBar.Value = 0;
                InterfaceHelper.SplashTextBox.Text = "Updating Atlas Metadata";
            }));

            var atlas_data = dataObj["atlas"];
            await Database.SQLiteInterface.InsertJsonData(atlas_data, "atlas_data");

            InterfaceHelper.SplashWindow.Dispatcher.Invoke((Action)(() =>
            {
                InterfaceHelper.SplashProgressBar.Value = 0;
                InterfaceHelper.SplashTextBox.Text = "Updating F95 Metadata";
            }));

            var f95_data = dataObj["f95_zone"];
            var sqlcmd = Database.SQLiteInterface.InsertJsonData(f95_data, "f95_zone_data");

            UpdateCompleted = true;
            return Task.CompletedTask;
        }      

    }
}