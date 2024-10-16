﻿using Atlas.Core;
using Atlas.Core.Database;
using Atlas.Core.Network;
using Atlas.Core.Utilities;
using Atlas.UI;
using Config.Net;
using Newtonsoft.Json.Linq;
using NLog;
using System.IO;
using System.Windows;
using static System.Net.WebRequestMethods;

namespace Atlas
{
    public partial class Launcher : Window
    {
        public static readonly Logger Logger = LogManager.GetCurrentClassLogger();
        public Launcher()
        {
            InitializeComponent();

            //Assign progressbar to helper
            InterfaceHelper.LauncherWindow = this;
            InterfaceHelper.LauncherProgressBar = LauncherProgressBar;
            InterfaceHelper.LauncherTextBox = LauncherTextBox;

            //This will be the default dispatcher for all UI elements that need to be updated from another thread
            //This does not include the Launcher. It uses its own thread.
            InterfaceHelper.Dispatcher = Application.Current.Dispatcher;

            //Check if program is already open
            if (System.Diagnostics.Process.GetProcessesByName(System.IO.Path.GetFileNameWithoutExtension(System.Reflection.Assembly.GetEntryAssembly().Location)).Count() > 1) System.Diagnostics.Process.GetCurrentProcess().Kill();


            Task.Run(async () =>
            {
                try
                {
                    //Run all tasks prior to opening
                    await Init();
                    //Launch Main Window
                    Application.Current.Dispatcher.Invoke((Action)delegate {
                        LaunchMainWindow();
                    });

                }
                catch (Exception ex)
                {
                    Logger.Error(ex);
                }
            });

        }

        public async Task Init()
        {
            UpdateLauncherText("Check For Updates");
            //Check for Program updates
            await Task.Run(async () =>
            {
                try
                {
                    await Updater.CheckForUpdatesAsync();
                }
                catch (Exception ex)
                {
                    Logger.Error(ex);
                }
            });
            UpdateLauncherProgressBar(5);

            UpdateLauncherText("Updating Folders");
            //Set folders
            try
            {
                Directory.CreateDirectory(System.IO.Path.Combine(Directory.GetCurrentDirectory(), "data"));
                Directory.CreateDirectory(System.IO.Path.Combine(Directory.GetCurrentDirectory(), "data", "games"));
                Directory.CreateDirectory(System.IO.Path.Combine(Directory.GetCurrentDirectory(), "data", "images"));
                Directory.CreateDirectory(System.IO.Path.Combine(Directory.GetCurrentDirectory(), "data", "logs"));
                Directory.CreateDirectory(System.IO.Path.Combine(Directory.GetCurrentDirectory(), "data", "updates"));
            }
            catch (Exception ex) { Logger.Error(ex); }
            UpdateLauncherProgressBar(10);

            UpdateLauncherText("Updating xaml Dependencies");
            //Add Settings
            Settings.Init();

            //Set the default theme file
            string theme = System.IO.Path.Combine(Directory.GetCurrentDirectory(), "themes", Settings.Config.Theme);
            var themeUri = new Uri(theme, UriKind.RelativeOrAbsolute);
            try
            {
                if (System.IO.File.Exists(theme))
                {
                    //This is not the best way to do this. We will need to change this
                    Application.Current.Resources.MergedDictionaries.RemoveAt(2);
                    Application.Current.Resources.MergedDictionaries.Add(new ResourceDictionary() { Source = themeUri });
                }
            }
            catch (Exception ex)
            {
                //Default to regular theme
                Logger.Error(ex);
            }
            UpdateLauncherProgressBar(20);

            UpdateLauncherText("Running DB Migrations");
            SQLiteInterface.Init();
            UpdateLauncherProgressBar(30);

            //Set progress before calling for update
            InterfaceHelper.ProgressBarStartValue = 40;

            UpdateLauncherText("Checking for DB Updates");
            //Check for database update
            await Task.Run(async () =>
            {
                try
                {
                    await CheckForDatabaseUpdateAsync();
                }
                catch (Exception ex)
                {
                    Logger.Warn(ex);
                }
            });

            //If we are here then we should be at 100%
            UpdateLauncherProgressBar(100);

            //Reset and load UI assets
            UpdateLauncherText("Loading Assets");

            //Load all games in whatever the default view is
            await Task.Run(async () =>
            {
                try
                {
                    await Application.Current.Dispatcher.Invoke(async() => {
                        // your code
                        ModelLoader loader = new ModelLoader();
                        await loader.CreateGamesList(Settings.Config.DefaultPage);
                    });
                    //Load the entire GameList before binding it to the view

                    //Pass the default pageview
                    
                }
                catch (Exception ex)
                {
                    Logger.Warn(ex);
                }
            });

            UpdateLauncherText("Launching Atlas");
            //System.Threading.Thread.Sleep(1000);
        }

        private async Task CheckForDatabaseUpdateAsync()
        {
            //https://atlas-gamesdb.com/updates/1715651134.update

            string url = "https://atlas-gamesdb.com/api/updates";
            JArray jsonArray = NetworkInterface.RequestJSON(url);
            if (jsonArray != null)
            {
                //Get data for latest update
                string date = jsonArray[0]["date"].ToString();
                string name = jsonArray[0]["name"].ToString();
                string md5 = jsonArray[0]["md5"].ToString();

                int lastDbUpdateVersion = SQLiteInterface.GetLastUpdateVersion();
                //Run db check to see if latest update is in database
                if (Convert.ToInt32(date) <= lastDbUpdateVersion && lastDbUpdateVersion != 0)
                    return;

                //Download latest update
                try
                {
                    UpdateLauncherText("Downloading Update");
                    string DownloadUrl = $"https://atlas-gamesdb.com/packages/{name}";
                    string OutputPath = Path.Combine(Directory.GetCurrentDirectory(), "data", "updates", name);

                    await NetworkInterface.DownloadFile(DownloadUrl, OutputPath);

                    string data = Compression.DecodeLZ4Stream(OutputPath);
                    UpdateLauncherText("Processing Update");
                    await UpdateInterface.ParseUpdate(data);

                    if (UpdateInterface.UpdateCompleted)
                    {
                        SQLiteInterface.InsertUpdateVersion(date, md5);
                    }

                    //update database with data
                    //Database.ProcessUpdate(OutputPath);
                }
                catch (Exception ex)
                {
                    Logger.Error(ex);
                }
            }
        }

        public void LaunchMainWindow()
        {
            MainWindow mainWindow = new MainWindow();
            mainWindow.Show();
            this.Close();
        }

        public void UpdateLauncherText(string text)
        {
            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Normal, () =>
            {
                LauncherTextBox.Text = text;
            });
        }
        public void UpdateLauncherProgressBar(int value)
        {
            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Normal, () =>
            {
                LauncherProgressBar.Value = value;
            });
        }
    }
}